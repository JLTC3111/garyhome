import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function endpoint({ validToken = true, vercel = false } = {}) {
  const calls = { tokens: [], verified: [], records: [] };
  const client = {
    auth: { getUser: async token => { calls.verified.push(token); return validToken ? { data: { user: { id: 'verified-customer' } }, error: null } : { data: { user: null }, error: new Error('Invalid token') }; } },
    from: table => ({ insert: async record => { assert.equal(table, 'enquiries'); calls.records.push(record); return { error: null }; } }),
  };
  const source = fs.readFileSync(new URL('../app/api/enquiries/route.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const loadedModule = { exports: {} };
  vm.runInThisContext('(function(exports,require,module,process){' + compiled + '\n})')(loadedModule.exports, id => id === '@/lib/server' ? { publicSupabase: token => { calls.tokens.push(token); return client; } } : require(id), loadedModule, { env: { VERCEL: vercel ? '1' : undefined } });
  const send = (overrides = {}, headers = {}) => loadedModule.exports.POST(new Request('https://gary.example/api/enquiries', {
    method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://gary.example', ...headers },
    body: JSON.stringify({ name: 'A Customer', email: 'customer@example.invalid', message: 'Please help me find a home.', consent: true, ...overrides }),
  }));
  return { send, calls };
}

test('guest enquiry input cannot choose identity or internal workflow fields', async () => {
  const { send, calls } = endpoint();
  const response = await send({ user_id: 'another-customer', notes: 'Forged staff note', status: 'scheduled', customer_update: 'Fake confirmation' });
  assert.equal(response.status, 201);assert.equal(calls.verified.length, 0);
  for (const field of ['user_id','notes','status','customer_update']) assert.ok(!(field in calls.records[0]));
});

test('signed-in enquiries use a verified bearer token and leave ownership to Postgres', async () => {
  const { send, calls } = endpoint();
  const response = await send({}, { authorization: 'Bearer customer-session-token' });
  assert.equal(response.status, 201);assert.deepEqual(calls.tokens, ['customer-session-token']);
  assert.deepEqual(calls.verified, ['customer-session-token']);assert.ok(!('user_id' in calls.records[0]));
});

test('invalid sessions are rejected instead of silently submitting as a guest', async () => {
  const { send, calls } = endpoint({ validToken: false });
  assert.equal((await send({}, { authorization: 'Bearer invalid-token' })).status, 401);
  assert.equal(calls.records.length, 0);
});

test('malformed authorization and cross-origin requests never reach the database', async () => {
  const { send, calls } = endpoint();
  assert.equal((await send({}, { authorization: 'Basic credentials' })).status, 401);
  assert.equal((await send({}, { origin: 'https://another.example' })).status, 403);
  assert.equal(calls.records.length, 0);assert.equal(calls.tokens.length, 0);
});

test('both guest and authenticated enquiries retain input validation and request limits', async () => {
  const { send, calls } = endpoint();
  assert.equal((await send({ consent: false })).status, 400);
  assert.equal((await send({ message: 'short' })).status, 400);
  for (let i = 0; i < 5; i++) assert.equal((await send({}, { authorization: 'Bearer customer-token' })).status, 201);
  assert.equal((await send({}, { authorization: 'Bearer customer-token' })).status, 429);
  assert.equal(calls.records.length, 5);
});

test('Vercel and Cloudflare rate limits isolate visitors using the host-owned IP header', async () => {
  for (const vercel of [false, true]) {
    const { send } = endpoint({ vercel });
    const trusted = vercel ? 'x-forwarded-for' : 'cf-connecting-ip';
    const untrusted = vercel ? 'cf-connecting-ip' : 'x-forwarded-for';
    for (let i = 0; i < 5; i++) assert.equal((await send({}, { [trusted]: '192.0.2.1', [untrusted]: `198.51.100.${i}` })).status, 201);
    assert.equal((await send({}, { [trusted]: '192.0.2.1', [untrusted]: '203.0.113.1' })).status, 429);
    assert.equal((await send({}, { [trusted]: '192.0.2.2', [untrusted]: '203.0.113.1' })).status, 201);
  }
});

test('retired batch requests cannot silently create a general enquiry',async()=>{
 const {send,calls}=endpoint();
 assert.equal((await send({property_ids:['c6e53881-53a0-45cf-bdce-7fe020b0a610']})).status,400);
 assert.equal(calls.records.length,0);
});
