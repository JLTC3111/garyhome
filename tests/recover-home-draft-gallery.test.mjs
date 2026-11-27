import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverAuditedDraftGallery } from '../scripts/recover-home-draft-gallery.mjs';

function packetRow(listing_code, id, count) {
  return {
    listing_code, id, status: 'draft', gallery: 0, blank_filenames: true, blank_metadata: true,
    created_at: '2026-11-26 01:00:00.123456+00', updated_at: '2026-11-26 02:00:00.123456+00',
    uploads: Array.from({ length: count }, (_, i) => ({
      path: `properties/listings/${id}/file-${i}.webp`,
      object_id: `7e3df871-3813-4481-a39f-${String(i).padStart(12, '0')}`,
      version: 'f499f0da-38d2-4b70-86ae-be21ab987857', bytes: '512', etag: 'a'.repeat(32),
      original_filename: `original-${i}.jpg`, mime: 'image/webp', referenced: false,
      same_creator: listing_code === 'GH-645', uploaded_at: `2026-11-26T01:20:${String(i).padStart(2, '0')}.000Z`,
    })).reverse(),
  };
}

function setup() {
  const packet = [packetRow('GH-645', '003be3a7-963d-4e2c-911d-90774a70fe44', 14),
    packetRow('GH-56', '198b8547-8614-4a8e-b125-7e6d9846df57', 2)];
  const state = {
    saved: { ...packet[0], updated_at: '2026-11-26T02:00:00.123456+00:00', images: [], image_filenames: {}, image_metadata: {} },
    writes: 0, checks: [], delivered: 0,
  };
  const api = {
    async review(input) {
      state.checks.push(input);
      if (input.action === 'orphan_page') return { available: true, items: Array(30), hasMore: true };
      return { result: 'listing' };
    },
    async verifyDelivery() { state.delivered++; },
    async readListing() { return state.saved; },
    async saveGallery(listing, gallery) {
      assert.equal(listing, state.saved);
      state.writes++;
      state.saved = { ...listing, ...gallery, updated_at: '2026-11-26T03:00:00.000+00:00' };
      throw new Error('Acknowledgement lost.');
    },
  };
  return { packet, state, api };
}

test('the recovery preview checks the signed page and both draft-scoped cohorts without writes', async () => {
  const { packet, state, api } = setup();
  const { preconditions, ...summary } = await recoverAuditedDraftGallery(packet, api);
  assert.deepEqual(summary, {
    ownerPageRows: 30, ownerPageHasMore: true, GH56Protected: 2, GH645IdentitiesVerified: 14, GH645Restored: false,
  });
  assert.ok(Object.values(preconditions.checks).every(field => field.matches));
  assert.equal(state.writes, 0);
  assert.equal(state.delivered, 14);
  assert.equal(state.checks.filter(check => check.action === 'orphan_verify').length, 16);
});

test('the GH-645 production row matches the audited recovery packet', async () => {
  const { packet, state, api } = setup();
  // Keep the recorded listing fields and the recovery packet's blank flags. Upload identities use test data.
  Object.assign(packet[0], {
    created_at: '2026-11-26 01:38:24.861+00', updated_at: '2026-11-26 01:55:11.193+00',
  });
  state.saved = {
    id: '003be3a7-963d-4e2c-911d-90774a70fe44', listing_code: 'GH-645', status: 'draft',
    created_at: '2026-11-26T01:38:24.861+00:00', updated_at: '2026-11-26T01:55:11.193+00:00',
    images: [], image_filenames: {}, image_metadata: {},
  };

  const { GH645Restored, preconditions: { recoveryPacket, checks } } = await recoverAuditedDraftGallery(packet, api);
  assert.equal(GH645Restored, false);
  assert.equal(state.writes, 0);
  assert.match(recoveryPacket.path, /gallery-recovery-packet-20261126\.json$/);
  assert.deepEqual(recoveryPacket.expectedRecordVersion, { raw: packet[0].updated_at, normalized: '2026-11-26T01:55:11.193000Z' });
  assert.equal(recoveryPacket.blank_filenames, true);
  assert.equal(recoveryPacket.blank_metadata, true);
  assert.deepEqual(checks.created_at, {
    expected: { raw: packet[0].created_at, normalized: '2026-11-26T01:38:24.861000Z' },
    actual: { raw: state.saved.created_at, normalized: '2026-11-26T01:38:24.861000Z' },
    matches: true,
  });
  assert.deepEqual(checks.updated_at.actual, { raw: state.saved.updated_at, normalized: '2026-11-26T01:55:11.193000Z' });
  assert.deepEqual(checks.images.actual, { type: 'array', count: 0, contents: [] });
  assert.deepEqual(checks.image_filenames, { expected: {}, actual: {}, matches: true });
  assert.deepEqual(checks.image_metadata, { expected: {}, actual: {}, matches: true });
});

test('recovery preserves the draft and confirms an ambiguous write without retrying', async () => {
  const { packet, state, api } = setup();
  assert.equal((await recoverAuditedDraftGallery(packet, api, true)).GH645Restored, true);
  assert.equal((await recoverAuditedDraftGallery(packet, api, true)).GH645Restored, true);
  assert.equal(state.writes, 1);
  assert.equal(state.saved.status, 'draft');
  assert.equal(state.saved.created_at, packet[0].created_at);
  assert.equal(state.saved.images.length, 14);
  assert.match(state.saved.images[0], /file-0\.webp$/);
  assert.equal(state.saved.image_filenames[state.saved.images[0]], 'original-0.jpg');
  assert.deepEqual(state.saved.image_metadata, {});
});

test('recovery stops on a concurrent edit at PostgreSQL timestamp precision', async () => {
  const { packet, state, api } = setup();
  state.saved.updated_at = '2026-11-26T02:00:00.123457+00:00';
  await assert.rejects(recoverAuditedDraftGallery(packet, api, true), error => {
    const [message, ...json] = error.message.split('\n');
    assert.equal(message, 'The GH-645 draft failed recovery preconditions.');
    const { checks } = JSON.parse(json.join('\n'));
    assert.deepEqual(Object.keys(checks).filter(key => !checks[key].matches), ['updated_at']);
    assert.deepEqual(checks.updated_at, {
      expected: { raw: packet[0].updated_at, normalized: '2026-11-26T02:00:00.123456Z' },
      actual: { raw: state.saved.updated_at, normalized: '2026-11-26T02:00:00.123457Z' },
      matches: false,
    });
    return true;
  });
  assert.equal(state.writes, 0);
});

test('the diagnostic reports every failed listing and gallery check together', async () => {
  const { packet, state, api } = setup();
  const image = 'https://example.test/changed.webp';
  Object.assign(state.saved, {
    id: packet[1].id, listing_code: 'GH-56', status: 'published', created_at: '2026-11-26T01:01:00Z',
    images: [image], image_filenames: { [image]: 'changed.webp' }, image_metadata: { [image]: { alt_en: 'Balcony' } },
  });

  await assert.rejects(recoverAuditedDraftGallery(packet, api), error => {
    const { checks } = JSON.parse(error.message.slice(error.message.indexOf('\n') + 1));
    assert.deepEqual(Object.keys(checks).filter(key => !checks[key].matches), [
      'id', 'listing_code', 'status', 'created_at', 'images', 'image_filenames', 'image_metadata',
    ]);
    assert.deepEqual(checks.id, { expected: packet[0].id, actual: packet[1].id, matches: false });
    assert.deepEqual(checks.listing_code, { expected: 'GH-645', actual: 'GH-56', matches: false });
    assert.deepEqual(checks.status, { expected: 'draft', actual: 'published', matches: false });
    assert.deepEqual(checks.images, {
      expected: { type: 'array', count: 0, contents: [] }, actual: { type: 'array', count: 1, contents: [image] }, matches: false,
    });
    assert.deepEqual(checks.image_filenames.actual, state.saved.image_filenames);
    assert.deepEqual(checks.image_metadata.actual, state.saved.image_metadata);
    return true;
  });
  assert.equal(state.writes, 0);
});

test('recovery stops before Owner requests when the packet does not confirm empty metadata', async () => {
  const { packet, state, api } = setup();
  packet[0].blank_metadata = false;
  await assert.rejects(recoverAuditedDraftGallery(packet, api, true), /packet must confirm empty filename and metadata fields/);
  assert.deepEqual(state.checks, []);
  assert.equal(state.writes, 0);
});
