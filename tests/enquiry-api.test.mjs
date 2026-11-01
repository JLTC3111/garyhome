import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { readJsonBody, BodyReadError } from '../lib/request-body.ts';
import { publicIntakeHarness } from './helpers/public-intake-harness.mjs';

const require = createRequire(import.meta.url);
function endpoint({ validToken = true, vercel = false, backend } = {}) {
  const intake=publicIntakeHarness({vercel,backend});
  const calls = { tokens: [], verified: [], records: [], intake:intake.state.calls };
  const client = {
    auth: { getUser: async token => { calls.verified.push(token); return validToken ? { data: { user: { id: 'verified-customer' } }, error: null } : { data: { user: null }, error: new Error('Invalid token') }; } },
    from: () => { throw new Error('Public clients must not write intake directly.'); },
  };
  const source = fs.readFileSync(new URL('../app/api/enquiries/route.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const loadedModule = { exports: {} };
  vm.runInThisContext('(function(exports,require,module,process){' + compiled + '\n})')(loadedModule.exports, id => id === '@/lib/request-body' ? { readJsonBody, BodyReadError } : id === '@/lib/public-intake' ? { savePublicIntake: async (...args) => { calls.records.push(args[2]); return intake.savePublicIntake(...args); } } : id === '@/lib/server' ? { publicSupabase: token => { calls.tokens.push(token); return client; } } : require(id), loadedModule, { env: { VERCEL: vercel ? '1' : undefined } });
  const send = (overrides = {}, headers = {}) => loadedModule.exports.POST(new Request('https://gary.example/api/enquiries', {
    method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://gary.example', ...headers },
    body: JSON.stringify({ name: 'A Customer', email: 'customer@example.invalid', message: 'Please help me find a home.', consent: true, ...overrides }),
  }));
  return { send, calls, POST: loadedModule.exports.POST };
}

test('guest enquiry input cannot choose identity or internal workflow fields', async () => {
  const { send, calls } = endpoint();
  const response = await send({ user_id: 'another-customer', notes: 'Forged staff note', status: 'scheduled', customer_update: 'Fake confirmation' });
  assert.equal(response.status, 201);assert.equal(calls.verified.length, 0);
  for (const field of ['user_id','notes','status','customer_update']) assert.ok(!(field in calls.records[0]));
  assert.equal(calls.intake[0].name,'submit_public_intake');assert.equal(calls.intake[0].args.channel,'enquiry');assert.equal(calls.intake[0].args.verified_user,null);
});

test('signed-in enquiries pass verified ownership separately from untrusted contact details', async () => {
  const { send, calls } = endpoint();
  const response = await send({}, { authorization: 'Bearer customer-session-token' });
  assert.equal(response.status, 201);assert.deepEqual(calls.tokens, ['customer-session-token']);
  assert.deepEqual(calls.verified, ['customer-session-token']);assert.ok(!('user_id' in calls.records[0]));assert.equal(calls.intake[0].args.verified_user,'verified-customer');
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


test('oversized streamed enquiries never reach Auth or the database',async()=>{
 const {POST,calls}=endpoint();let cancelled=false,pulls=0;
 const body=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(8192));},cancel(){cancelled=true;}});
 const response=await POST(new Request('https://gary.example/api/enquiries',{method:'POST',duplex:'half',headers:{origin:'https://gary.example','content-type':'application/json','content-length':'1'},body}));
 assert.equal(response.status,413);assert.equal(cancelled,true);assert.ok(pulls<=3);assert.equal(calls.records.length,0);assert.equal(calls.verified.length,0);
});


test('durable enquiry quotas reject a submission even when the current instance has no request history',async()=>{
 const backend={calls:[],data:null},h=endpoint({backend});
 const response=await h.send();assert.equal(response.status,429);assert.equal(backend.calls.length,1);assert.equal((await response.json()).ok,undefined);
});
test('unavailable trusted configuration and uncertain enquiry writes never report success',async()=>{
 for(const backend of [{calls:[],unavailable:true},{calls:[],error:{code:'42501',message:'private database detail'}},{calls:[],throwError:new Error('private transport detail')}]){
  const h=endpoint({backend}),response=await h.send();assert.equal(response.status,503);const result=await response.text();assert.doesNotMatch(result,/private database|private transport|"ok":true/);
 }
});
