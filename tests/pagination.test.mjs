import test from 'node:test';
import assert from 'node:assert/strict';
import { readAllRows } from '../lib/pagination.ts';

test('pagination exhausts results even when the server cap is below the requested page size', async () => {
  const source = Array.from({length: 1001}, (_, id) => ({id})), ranges = [];
  const result = await readAllRows(async (from, to) => {
    ranges.push([from, to]);
    return {data: source.slice(from, Math.min(to + 1, from + 200)), error: null};
  });
  assert.deepEqual(result, source);
  assert.deepEqual(ranges.map(([from]) => from), [0,200,400,600,800,1000,1001]);
});

test('a later-page failure rejects the entire read instead of returning a partial catalogue', async () => {
  const denied = {code: '42501'};
  await assert.rejects(readAllRows(async from => from === 0
    ? {data: [{id: 'first'}], error: null}
    : {data: null, error: denied}), error => error === denied);
});
