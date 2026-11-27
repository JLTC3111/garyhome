import assert from 'node:assert/strict';
import test from 'node:test';
import { maxTrashSelection, removeSelectedTrash } from '../lib/home-media-trash.ts';

const expiry = '2026-11-29T05:16:07.673731Z';

test('early removal sends exact, confirmed per-file requests sequentially and reports retained files', async () => {
  const items = ['one', 'two', 'three'].map(id => ({ id, expires_at: expiry }));
  const calls = [];
  let inFlight = false;
  const result = await removeSelectedTrash(items, async payload => {
    assert.equal(inFlight, false);
    inFlight = true;
    calls.push(payload);
    await Promise.resolve();
    inFlight = false;
    return payload.id === 'two' ? { status: 'ok', removed: 0 } : { status: 'ok', removed: 1 };
  });
  assert.deepEqual(calls, items.map(item => ({ action: 'purge', id: item.id, expiresAt: expiry, confirm: true })));
  assert.equal(result.removed, 2);
  assert.deepEqual(result.failures.map(row => [row.id, row.error.message]), [['two', 'purge_unconfirmed']]);
});

test('bulk early removal rejects stale or oversized selections before any request', async () => {
  const request = () => assert.fail('Invalid selections must never be sent');
  await assert.rejects(removeSelectedTrash([{ id: 'one', expires_at: null }], request), /invalid_request/);
  await assert.rejects(removeSelectedTrash(Array.from({ length: maxTrashSelection + 1 }, (_, index) => ({ id: String(index), expires_at: expiry })), request), /invalid_request/);
});
