import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { PROPERTY_IMAGE_ORIGIN } from '../lib/property-photo-files.ts';
import { digest, readJson, writeAtomic } from './plan-property-image-optimization.mjs';
import { storageStages, uuid } from './property-media-migration-transport.mjs';
import { homeOwnerSession } from './property-media-session.mjs';

const auditDirectory = fileURLToPath(new URL('../work/property-media-audit-20261125.1T3KYQ/', import.meta.url));
const worksheetPath = join(auditDirectory, 'historical-orphan-review-worksheet-20261127.csv');
const workDirectory = join(auditDirectory, 'historical-orphan-enrollment');
const ledgerName = 'checkpoint.json';
const batchSize = 8;
const attemptLimit = 3;
const sha256 = /^[a-f0-9]{64}$/;
const historicalChecksum = '0e2a7f77be12267d0e463d8cbc0ede1dfb89200c4fc61755740e0b09d830b8bf';
const gh56Checksum = '9e4754cb4843fa03190c3a968ad03d1f1f4f4a5d4a64135c2ac6c273ba0dafd2';
const storageTag = /^[a-fA-F0-9]{32}(?:-[0-9]+)?$/;
const cleanTag = value => String(value ?? '').trim().replace(/^"|"$/g, '');
const isAbsent = error => error.code === 'ENOENT';
const identity = ({ key, objectId, version, bytes, scope }) => ({ key, objectId, version, bytes, scope });
const intake = row => ({ ...identity(row), authorizationId: row.authorizationId });
const proof = row => ({ ...intake(row), etag: row.etag, backupSha256: row.backupSha256 });
const sumBytes = rows => rows.reduce((total, row) => total + row.bytes, 0);

function parseWorksheet(source) {
  const lines = source.replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/);
  return lines.map((line, index) => {
    const pattern = /(?:"((?:[^"\r\n]|"")*)"|([^",\r\n]*))(,|$)/gy;
    const fields = [];
    for (;;) {
      const match = pattern.exec(line);
      if (!match) throw new Error(`Invalid worksheet CSV on line ${index + 1}.`);
      fields.push(match[1] === undefined ? match[2] : match[1].replaceAll('""', '"'));
      if (match[3] === '') return fields;
    }
  });
}

function worksheetBackups(source, rowsById, base) {
  const [header, ...rows] = parseWorksheet(source);
  const backups = new Map();
  for (const cells of rows) {
    const fields = Object.fromEntries(header.map((name, column) => [name, cells[column]]));
    const objectId = fields['Object ID'];
    const row = rowsById.get(objectId);
    if (!row || fields.Bucket !== 'property-media' || fields['Storage key'] !== row.key ||
        fields.Version !== row.version || fields.Bytes !== String(row.bytes)) continue;
    const path = fields['Local backup path']?.trim();
    const checksum = fields['Verified SHA-256']?.trim();
    const etag = cleanTag(fields['Verified ETag']);
    if (path && sha256.test(checksum ?? '') && storageTag.test(etag)) {
      backups.set(objectId, { path: resolve(base, path), sha256: checksum, etag });
    }
  }
  return backups;
}

export function buildBulkManifest(audit, packet) {
  if (audit.bucket !== 'property-media' || audit.objects?.length !== 617) throw new Error('The original 617-object audit is required.');
  const historical = audit.objects.filter(row => !row.retentionReasons.some(reason => ['filename_only_match', 'saved_listing_scope'].includes(reason)))
    .map(row => ({ key: row.path, objectId: row.id, version: row.version, bytes: row.bytes, scope: 'historical' }));
  const draft = packet.find(row => row.id === '198b8547-8614-4a8e-b125-7e6d9846df57' && row.listing_code === 'GH-56');
  const gh56 = (draft?.uploads ?? []).map(row => ({ key: row.path, objectId: row.object_id, version: row.version, bytes: Number(row.bytes), scope: 'GH-56' }));
  const canonical = rows => JSON.stringify([...rows].sort((a, b) => a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0)
    .map(row => [row.objectId, row.version, row.bytes, row.key]));
  const manifest = canonical(historical), gh56Manifest = canonical(gh56);
  if (historical.length !== 499 || gh56.length !== 2 || digest(manifest) !== historicalChecksum || digest(gh56Manifest) !== gh56Checksum) {
    throw new Error('The audited historical or GH-56 manifest differs from the sealed checksum.');
  }
  return { manifest, gh56Manifest, candidates: [...gh56, ...historical.sort((a, b) => a.bytes - b.bytes)],
    summary: { files: historical.length, bytes: sumBytes(historical), excluded: audit.objects.length - historical.length,
      manifestSha256: historicalChecksum, gh56Files: gh56.length, gh56Bytes: sumBytes(gh56), gh56Sha256: gh56Checksum } };
}

async function loadLedger(work) {
  const ledger = await readJson(join(work, ledgerName)).catch(error => {
    if (!isAbsent(error)) throw error;
    return { version: 1, reservedBytes: 0, items: {} };
  });
  if (ledger.version !== 1 || !Number.isSafeInteger(ledger.reservedBytes) || ledger.reservedBytes < 0 ||
      !ledger.items || Object.values(ledger.items).some(row => !uuid.test(row.objectId) ||
        !Number.isSafeInteger(row.downloadAttempts) || row.downloadAttempts < 0 || row.downloadAttempts > attemptLimit ||
        !Number.isSafeInteger(row.enrollAttempts) || row.enrollAttempts < 0 || row.enrollAttempts > attemptLimit) ||
      Object.values(ledger.items).reduce((bytes, row) => bytes + row.bytes * row.downloadAttempts, 0) !== ledger.reservedBytes) {
    throw new Error('The local checkpoint is invalid. Reconcile it before continuing.');
  }
  return ledger;
}

const backupPath = (work, row) => join(work, 'backups', `${row.objectId}.original`);
async function checkedBackup(path, bytes, sha) {
  const found = await stat(path).catch(error => { if (!isAbsent(error)) throw error; return null; });
  if (!found) return null;
  if (!found.isFile() || found.size !== bytes) throw new Error('The local backup has an unexpected type or size.');
  const data = await readFile(path);
  if (data.length !== bytes || digest(data) !== sha) throw new Error('The local backup SHA-256 does not match.');
  return data;
}

function acceptReceipt(row, response) {
  if (response.status !== 'receipt' || !uuid.test(response.id ?? '') ||
      Date.parse(response.expiresAt) - Date.parse(response.enrolledAt) !== 48 * 60 * 60 * 1000 ||
      (row.receipt && (row.receipt.id !== response.id || row.receipt.expiresAt !== response.expiresAt))) {
    return false;
  }
  row.receipt = response;
  row.status = response.state;
  return true;
}

export async function enrollBatch(candidates, { api, work, ledger, save, budget, authorizationId }) {
  if (candidates.length > batchSize || budget < ledger.reservedBytes || !uuid.test(authorizationId ?? '')) {
    throw new Error('Invalid batch size, authorization or cumulative egress budget.');
  }
  const results = [];
  for (const candidate of candidates) {
    if (candidate.flagged) continue;
    let row = ledger.items[candidate.objectId];
    if (row?.receipt) continue;
    if (row && (JSON.stringify(identity(row)) !== JSON.stringify(identity(candidate)) ||
        (row.authorizationId && row.authorizationId !== authorizationId) || (!row.authorizationId && row.enrollAttempts))) {
      results.push({ objectId: candidate.objectId, status: 'checkpoint_conflict' });
      continue;
    }
    row ??= ledger.items[candidate.objectId] = { ...identity(candidate),
      downloadAttempts: 0, enrollAttempts: 0, status: 'pending' };
    row.authorizationId = authorizationId;
    const record = async (status, reason) => {
      row.status = status;
      row.reason = reason;
      results.push({ objectId: row.objectId, status, reason });
      await save();
    };
    if (row.enrollAttempts) {
      const receipt = await api.rpc('receipt', proof(row));
      if (receipt.status === 'receipt') {
        await record(acceptReceipt(row, receipt) ? row.status : 'receipt_mismatch');
        continue;
      }
      if (receipt.status !== 'missing') { await record(receipt.status); continue; }
    }
    if (row.enrollAttempts >= attemptLimit) { await record('enrollment_attempt_limit'); continue; }
    const check = await api.rpc('inspect', intake(row));
    if (check.status !== 'evidence_required') { await record(check.status); continue; }
    if (!storageTag.test(check.etag) || !/^image\/(jpeg|png|webp|avif)$/.test(check.mime) || (row.etag && row.etag !== check.etag)) {
      await record('identity'); continue;
    }
    row.etag = check.etag;
    row.mime = check.mime;
    const path = backupPath(work, row);
    let backup;
    try {
      backup = row.backupSha256 ? await checkedBackup(path, row.bytes, row.backupSha256) : null;
      if (!backup && candidate.reuse?.etag === row.etag) {
        backup = await checkedBackup(candidate.reuse.path, row.bytes, candidate.reuse.sha256);
        if (backup) {
          row.backupSha256 = candidate.reuse.sha256;
          row.status = 'backing_up';
          await save();
        }
      }
    } catch {
      await record('backup_verification_failed');
      continue;
    }
    if (backup && !(await stat(path).catch(error => { if (!isAbsent(error)) throw error; return null; }))) {
      await writeAtomic(path, backup, true);
    }
    if (!backup) {
      if (candidate.reuse) {
        if (candidate.reuse.etag !== row.etag) { await record('backup_identity'); continue; }
        await record('backup_missing'); continue;
      }
      if (row.downloadAttempts >= attemptLimit) { await record('download_attempt_limit'); continue; }
      if (ledger.reservedBytes + row.bytes > budget) { await record('egress_budget'); continue; }
      ledger.reservedBytes += row.bytes;
      row.downloadAttempts++;
      row.status = 'downloading';
      await save();
      try {
        backup = await api.readOnce({ ...row, sha256: row.backupSha256 });
        if (backup.length !== row.bytes) throw new Error('Storage did not return the reserved original size.');
      } catch (error) {
        if ([401, 402, 429].includes(error.status)) throw error;
        await record('download_verification_failed', error.status ? `Storage HTTP ${error.status}` : error.message);
        continue;
      }
      row.backupSha256 = digest(backup);
      row.status = 'backing_up';
      await save();
      await writeAtomic(path, backup, true);
    }
    if (!await checkedBackup(path, row.bytes, row.backupSha256).catch(() => null)) {
      await record('backup_verification_failed');
      continue;
    }
    row.enrollAttempts++;
    row.status = 'enrolling';
    await save();
    const receipt = await api.rpc('enroll', { ...proof(row), confirm: true });
    if (receipt.status !== 'receipt') { await record(receipt.status); continue; }
    await record(acceptReceipt(row, receipt) ? row.status : 'receipt_mismatch');
  }
  return results;
}

async function verifyBatch(rows, api, work) {
  const results = [];
  for (const row of rows) {
    const receipt = await api.rpc('receipt', proof(row));
    if (receipt.status === 'receipt' && !acceptReceipt(row, receipt)) receipt.status = 'receipt_mismatch';
    const backup = !!await checkedBackup(backupPath(work, row), row.bytes, row.backupSha256).catch(() => null);
    const storageVerified = receipt.state === 'removed' ? receipt.storagePresent === false && !!receipt.removedAt : receipt.liveObjectMatches === true;
    results.push({ objectId: row.objectId, backup, storageVerified, ...receipt });
  }
  return results;
}

function connectIntake({ GARY_MEDIA_PUBLISHABLE_KEY: key, GARY_MEDIA_OWNER_TOKEN: token }) {
  const storage = storageStages({ key, token });
  const call = async (name, body) => {
    const response = await fetch(`${PROPERTY_IMAGE_ORIGIN}/rest/v1/rpc/${name}`, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000),
      headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) throw new Error('Apply the historical bulk enrollment migration before using live modes.');
      if (name === 'home_media_historical_intake') {
        if (response.status === 409) return { status: 'guard_conflict' };
        if ([400, 408, 500, 502, 503, 504].includes(response.status)) return { status: `verification_http_${response.status}` };
      }
      throw new Error(`Owner ${name} returned HTTP ${response.status}.`);
    }
    return response.json();
  };
  return { readOnce: storage.readOnce, authorize: input => call('home_media_authorize_bulk', input),
    rpc: (action, input) => call('home_media_historical_intake', { p_action: action, p_review: input }) };
}

async function withLock(work, run) {
  await mkdir(join(work, 'backups'), { recursive: true, mode: 0o700 });
  const path = join(work, '.enrollment.lock');
  const lock = await open(path, 'wx', 0o600).catch(error => {
    if (error.code === 'EEXIST') throw new Error('Enrollment is locked. Check the recorded PID before clearing an abandoned lock.');
    throw error;
  });
  const releaseOnExit = () => { try { unlinkSync(path); } catch {} };
  const interrupt = () => process.exit(130);
  process.once('exit', releaseOnExit);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, interrupt);
  try {
    await lock.writeFile(`${process.pid}\n`);
    return await run();
  } finally {
    process.removeListener('exit', releaseOnExit);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(signal, interrupt);
    await lock.close();
    await unlink(path);
  }
}

export async function authorizeRun(plan, ledger, { api, mode, budget, confirm, save }) {
  const saved = ledger.authorization;
  if (mode === 'enroll' && saved) throw new Error('This manifest already has a recorded confirmation. Use resume.');
  if (mode === 'resume' && !saved) throw new Error('No Owner confirmation is recorded. Start with enroll.');
  const id = saved?.id ?? randomUUID();
  const initialBudget = saved?.initialBudget ?? budget;
  const request = { p_id: id, p_manifest: plan.manifest, p_gh56_manifest: plan.gh56Manifest, p_budget: initialBudget };
  const preview = await api.authorize({ ...request, p_confirm: false });
  if (!uuid.test(preview.actorId ?? '') || Object.entries(plan.summary).some(([field, expected]) => preview[field] !== expected) ||
      (saved && (preview.actorId !== saved.actorId || saved.manifestSha256 !== preview.manifestSha256 || saved.gh56Sha256 !== preview.gh56Sha256))) {
    throw new Error('The current Owner or manifest does not match this authorization.');
  }
  if (!saved) {
    if (!await confirm(plan.summary, budget)) return null;
    ledger.authorization = { id, actorId: preview.actorId, manifestSha256: preview.manifestSha256,
      gh56Sha256: preview.gh56Sha256, initialBudget, confirmedAt: new Date().toISOString() };
    ledger.budgetBytes = budget;
    await save();
  }
  const approval = await api.authorize({ ...request, p_confirm: true });
  if (approval.id !== id || approval.actorId !== preview.actorId || approval.manifestSha256 !== preview.manifestSha256 ||
      approval.gh56Sha256 !== preview.gh56Sha256 || approval.reference !== `owner-bulk-authorization:${id}` ||
      !Number.isFinite(Date.parse(approval.authorizedAt))) throw new Error('The Owner authorization receipt could not be confirmed. Use resume.');
  ledger.budgetBytes = budget;
  ledger.authorization.reference = approval.reference;
  ledger.authorization.authorizedAt = approval.authorizedAt;
  await save();
  return ledger.authorization;
}

async function confirmEnrollment(summary, budget) {
  if (!process.stdin.isTTY) throw new Error('Confirm enrollment interactively in your local Terminal.');
  console.log(`Historical candidates: ${summary.files} files, ${summary.bytes.toLocaleString('en-US')} bytes.`);
  console.log(`Excluded: ${summary.excluded} files with known filename or listing-scope flags.`);
  console.log(`Historical manifest SHA-256: ${summary.manifestSha256}`);
  console.log(`GH-56 prior Owner confirmation: ${summary.gh56Files} files, ${summary.gh56Bytes.toLocaleString('en-US')} bytes.`);
  console.log(`Cumulative file payload budget: ${budget.toLocaleString('en-US')} bytes. Eligible files enter File Trash for 48 hours.`);
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await terminal.question('Type ENROLL to record your Owner authorization for this manifest: ')).trim() === 'ENROLL'; }
  finally { terminal.close(); }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'egress-budget-bytes': { type: 'string' }, 'max-batches': { type: 'string', default: '63' },
  } });
  const mode = positionals[0] ?? 'dry-run';
  const mutate = mode === 'enroll' || mode === 'resume';
  const maxBatches = Number(values['max-batches']);
  const budgetInput = values['egress-budget-bytes'];
  const explicitBudget = budgetInput === undefined ? undefined : Number(budgetInput);
  if (positionals.length > 1 || !['dry-run', 'enroll', 'resume', 'verify'].includes(mode) ||
      !Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 63 ||
      (budgetInput !== undefined && (!mutate || !/^\d+$/.test(budgetInput) || !Number.isSafeInteger(explicitBudget)))) {
    throw new Error('Use dry-run, enroll, resume or verify. Set --egress-budget-bytes on enroll or resume to choose a cumulative limit.');
  }
  const connect = () => homeOwnerSession({ env: process.env, connect: connectIntake });
  if (mode === 'verify') {
    const ledger = await loadLedger(workDirectory);
    const rows = Object.values(ledger.items).filter(row => row.authorizationId && row.enrollAttempts);
    const openSession = rows.length ? await connect() : null;
    let failures = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      for (const result of await verifyBatch(rows.slice(i, i + batchSize), await openSession(), workDirectory)) {
        if (result.status !== 'receipt' || !result.backup || !result.storageVerified) failures++;
        console.log(JSON.stringify(result));
      }
    }
    console.log(JSON.stringify({ verified: rows.length - failures, unresolved: failures, reservedBytes: ledger.reservedBytes }));
    return failures ? 2 : 0;
  }
  const plan = buildBulkManifest(await readJson(join(auditDirectory, 'production-orphan-classification-20261126.json')),
    await readJson(join(auditDirectory, 'gallery-recovery-packet-20261126.json')));
  if (mode === 'dry-run') {
    const ledger = await loadLedger(workDirectory);
    const pending = plan.candidates.filter(row => !ledger.items[row.objectId]?.receipt);
    console.log(JSON.stringify({ ...plan.summary, authorized: !!ledger.authorization?.authorizedAt, pending: pending.length,
      pendingBytes: sumBytes(pending), reservedBytes: ledger.reservedBytes }));
    return 0;
  }
  return withLock(workDirectory, async () => {
    const ledger = await loadLedger(workDirectory);
    const budget = explicitBudget ?? ledger.budgetBytes ?? sumBytes(plan.candidates);
    if (budget < ledger.reservedBytes) throw new Error('The egress budget is below the checkpoint’s existing reservations.');
    if (mode === 'enroll' && ledger.authorization) throw new Error('This manifest already has a recorded confirmation. Use resume.');
    if (mode === 'resume' && !ledger.authorization) throw new Error('No Owner confirmation is recorded. Start with enroll.');
    const openSession = await connect();
    const save = () => writeAtomic(join(workDirectory, ledgerName), JSON.stringify(ledger, null, 2) + '\n');
    const authorization = await authorizeRun(plan, ledger, { api: await openSession(), mode, budget, confirm: confirmEnrollment, save });
    if (!authorization) return 0;
    console.log(JSON.stringify({ authorization: authorization.reference, cumulativeBudgetBytes: budget }));
    const worksheet = await readFile(worksheetPath, 'utf8').catch(error => { if (!isAbsent(error)) throw error; return null; });
    let backups = new Map();
    if (worksheet) {
      try { backups = worksheetBackups(worksheet, new Map(plan.candidates.map(row => [row.objectId, row])), dirname(worksheetPath)); }
      catch { console.log('Optional worksheet backup receipts could not be read. Enrolled backups remain in the checkpoint.'); }
    }
    const priority = row => {
      const status = ledger.items[row.objectId]?.status;
      if (['downloading', 'backing_up', 'enrolling'].includes(status)) return 0;
      return status ? 2 : 1;
    };
    const pending = plan.candidates.filter(row => !ledger.items[row.objectId]?.receipt)
      .sort((a, b) => priority(a) - priority(b)).slice(0, maxBatches * batchSize)
      .map(row => ({ ...row, reuse: backups.get(row.objectId) }));
    let blocked = 0;
    for (let i = 0; i < pending.length; i += batchSize) {
      const api = await openSession();
      const results = await enrollBatch(pending.slice(i, i + batchSize),
        { api, work: workDirectory, ledger, save, budget, authorizationId: authorization.id });
      blocked += results.filter(result => !ledger.items[result.objectId].receipt).length;
      console.log(JSON.stringify({ batch: i / batchSize + 1, results, reservedBytes: ledger.reservedBytes }));
    }
    console.log(JSON.stringify({ authorizedFiles: plan.candidates.length, processed: pending.length, blocked,
      reservedBytes: ledger.reservedBytes, checkpoint: join(workDirectory, ledgerName) }));
    return blocked ? 2 : 0;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Historical enrollment is unconfirmed.');
    process.exitCode = 1;
  }
}
