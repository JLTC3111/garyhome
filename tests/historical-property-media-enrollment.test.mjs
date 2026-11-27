import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { authorizeRun, enrollBatch } from '../scripts/enroll-historical-property-media.mjs';
import { digest } from '../scripts/plan-property-image-optimization.mjs';
import { storageStages } from '../scripts/property-media-migration-transport.mjs';

const id = number => `cac28d75-fd70-4b0f-9630-${String(number).padStart(12, '0')}`;
const version = id(9001);
const data = Buffer.from('photo bytes');
const tag = 'a'.repeat(32) + '-1';
const authorizationId = id(8020);
const candidate = (number = 1) => ({ objectId: id(number), version, key: `properties/fixture-${number}.webp`,
  bytes: data.length, scope: 'historical' });

test('one reserved download sends If-Match and does not retry a transient Storage failure', async () => {
  let requests = 0;
  const storage = storageStages({ key: 'sb_publishable_fixture', token: 'owner-fixture', pace: async () => {},
    wait: async () => assert.fail('the one-attempt transport must not retry'),
    async fetcher(_url, options) {
      requests++;
      assert.equal(options.headers['if-match'], `"${tag}"`);
      return new Response(null, { status: 503 });
    } });
  await assert.rejects(storage.readOnce({ ...candidate(), etag: tag, mime: 'image/webp' }), /returned HTTP 503/);
  assert.equal(requests, 1);
});

test('a lost confirmation acknowledgement resumes with the same ID and without asking twice', async () => {
  const plan = { manifest: 'local manifest', gh56Manifest: 'GH-56 manifest',
    summary: { files: 499, excluded: 118, manifestSha256: 'a'.repeat(64), gh56Sha256: 'b'.repeat(64) } };
  const ledger = {};
  let confirmations = 0, initiated = null;
  const preview = { actorId: id(62), ...plan.summary };
  const api = { async authorize(request) {
    if (!request.p_confirm) return preview;
    assert.equal(ledger.authorization.id, request.p_id, 'intent is durable before the request');
    if (!initiated) { initiated = request; throw new Error('confirmation acknowledgement lost'); }
    assert.deepEqual(request, initiated);
    return { ...preview, id: request.p_id, reference: `owner-bulk-authorization:${request.p_id}`, authorizedAt: '2026-11-26T12:00:00Z' };
  } };
  const confirm = async () => { confirmations++; return true; };
  const save = async () => {};
  await assert.rejects(authorizeRun(plan, ledger, { mode: 'enroll', budget: 120, api, confirm, save }), /acknowledgement lost/);
  assert.equal(ledger.budgetBytes, 120);
  const receipt = await authorizeRun(plan, ledger, { mode: 'resume', budget: 120, api, confirm, save });
  assert.equal(receipt.id, initiated.p_id);
  assert.equal(confirmations, 1);
});

test('declining the manifest confirmation leaves the checkpoint and server authorization untouched', async () => {
  const ledger = {};
  const result = await authorizeRun({ manifest: 'fixture', gh56Manifest: 'case fixture', summary: { files: 499 } }, ledger, {
    mode: 'enroll', budget: 100,
    api: { async authorize(input) { assert.equal(input.p_confirm, false); return { actorId: id(62), files: 499 }; } },
    confirm: async () => false,
    save: async () => assert.fail('declined authorization must never be checkpointed'),
  });
  assert.equal(result, null);
  assert.deepEqual(ledger, {});
});

async function fixture(t) {
  const work = await mkdtemp(join(tmpdir(), 'home-orphan-test-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  await mkdir(join(work, 'backups'));
  const stats = { calls: [], downloads: 0, saved: null };
  const ledger = { version: 1, reservedBytes: 0, items: {} };
  const receipt = { status: 'receipt', id: id(99), state: 'trashed', liveObjectMatches: true, storagePresent: true,
    enrolledAt: '2026-11-26T12:00:00Z', expiresAt: '2026-11-28T12:00:00Z' };
  let completed = false;
  const api = {
    async rpc(action, payload) {
      stats.calls.push(action);
      if (action === 'inspect') return { status: 'evidence_required', etag: tag, mime: 'image/webp' };
      if (action === 'receipt') return completed ? receipt : { status: 'missing' };
      assert.equal(payload.backupSha256, digest(data));
      assert.equal(payload.authorizationId, authorizationId);
      assert.equal(payload.evidenceRef, undefined);
      assert.equal(payload.confirm, true);
      completed = true;
      return receipt;
    },
    async readOnce() {
      stats.downloads++;
      assert.equal(stats.saved.reservedBytes, stats.downloads * data.length);
      return data;
    },
  };
  return { stats, context: { api, work, ledger, authorizationId, budget: data.length, async save() { stats.saved = structuredClone(ledger); } } };
}

test('a failed download stays reserved and neither a held file nor an oversized batch downloads', async t => {
  const { context, stats } = await fixture(t);
  const original = context.api.readOnce;
  context.api.readOnce = async row => { await original(row); throw new Error('transfer interrupted'); };
  await assert.rejects(enrollBatch(Array.from({ length: 9 }, (_, i) => candidate(i)), context), /batch size/);
  assert.deepEqual(await enrollBatch([{ ...candidate(), flagged: true }], context), []);
  assert.equal(stats.calls.length, 0);
  const failures = await enrollBatch([candidate(), candidate(2)], context);
  assert.deepEqual(failures.map(row => row.status), ['download_verification_failed', 'egress_budget']);
  assert.match(failures[0].reason, /interrupted/);
  assert.equal(stats.saved.reservedBytes, data.length);
  assert.equal((await enrollBatch([candidate()], context))[0].status, 'egress_budget');
  assert.equal(stats.downloads, 1);
  assert.ok(!stats.calls.includes('enroll'));
});

test('a failed live dependency check skips only its file and records the next exact receipt', async t => {
  const { context, stats } = await fixture(t);
  const rpc = context.api.rpc;
  context.api.rpc = async (action, input) => action === 'inspect' && input.objectId === id(1) ? { status: 'owner_hold' } : rpc(action, input);
  assert.deepEqual((await enrollBatch([candidate(), candidate(2)], context)).map(row => row.status), ['owner_hold', 'trashed']);
  assert.equal(stats.downloads, 1);
  assert.equal(stats.saved.items[id(2)].receipt.state, 'trashed');
});

test('readback retrieves a lost enrollment acknowledgement without a second download or enrollment', async t => {
  const { context, stats } = await fixture(t);
  const rpc = context.api.rpc;
  context.api.rpc = async (action, payload) => {
    const result = await rpc(action, payload);
    if (action === 'enroll') throw new Error('acknowledgement lost');
    return result;
  };
  await assert.rejects(enrollBatch([candidate()], context), /acknowledgement lost/);
  assert.equal(stats.saved.items[id(1)].status, 'enrolling');
  assert.deepEqual(await readFile(join(context.work, 'backups', `${id(1)}.original`)), data);
  const result = await enrollBatch([candidate()], context);
  assert.equal(result[0].status, 'trashed');
  assert.equal(stats.saved.items[id(1)].receipt.expiresAt, '2026-11-28T12:00:00Z');
  assert.equal(stats.calls.filter(action => action === 'enroll').length, 1);
  assert.equal(stats.downloads, 1);
});

test('an identity-matching verified local backup enrolls with zero download budget', async t => {
  const { context, stats } = await fixture(t);
  const path = join(context.work, 'previous-file.webp');
  await writeFile(path, data);
  const row = { ...candidate(), reuse: { path, sha256: digest(data), etag: tag } };
  const result = await enrollBatch([row], { ...context, budget: 0 });
  assert.equal(result[0].status, 'trashed');
  assert.equal(stats.saved.reservedBytes, 0);
  assert.equal(stats.downloads, 0);
  assert.deepEqual(await readFile(join(context.work, 'backups', `${id(1)}.original`)), data);
});
