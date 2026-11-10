import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';

const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
const actor='10000000-0000-4000-8000-000000000001',runId='20000000-0000-4000-8000-000000000002';
const limits={maxUrls:500,maxDepth:4,concurrency:2,requestIntervalMs:1000,timeoutMs:10000,maxDurationMs:900000};
// Run the actual route, schema, body reader, timeout wrapper and error classes.
// Only staff authorization and the service/store boundaries are substituted;
// a fixture process environment keeps real credentials out of the module graph.
function endpoint(options={}) {
  const state={role:'editor',valid:true,trace:[],updates:[],activeRun:null,secret:'fixture-cron-secret',...options};
  const database={fixture:true},cache=new Map(),environment={};
  if(state.secret!==undefined)environment.CRON_SECRET=state.secret;
  const service={
    auditDatabase(){state.trace.push({op:'database'});return database;},
    async startAudit(...args){state.trace.push({op:'start',args});if(state.serviceError)throw new Error('fixture failure');return {id:runId};},
    async advanceAudit(...args){state.trace.push({op:'advance',args});if(state.serviceError)throw new Error('fixture failure');},
  };
  const store={
    async auditSnapshot(db,id){assert.equal(db,database);state.trace.push({op:'snapshot',id});return {runs:[],settings:{weeklyEnabled:false,limits},activeRun:state.activeRun,selectedRun:null};},
    async updateAuditSettings(db,value){assert.equal(db,database);state.trace.push({op:'settings'});state.updates.push(value);},
  };
  function load(file) {
    if(file===path.join(root,'lib/seo-audit/service.ts'))return service;
    if(file===path.join(root,'lib/seo-audit/store.ts'))return store;
    if(cache.has(file))return cache.get(file).exports;
    if(file.endsWith('.json'))return JSON.parse(fs.readFileSync(file,'utf8'));
    const loadedModule={exports:{}};cache.set(file,loadedModule);
    const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
    const dependency=id=>{
      if(id.startsWith('.')||id.startsWith('@/')) {
        const base=id.startsWith('@/')?path.join(root,id.slice(2)):path.resolve(path.dirname(file),id);
        const resolved=[base,base+'.ts',base+'.tsx'].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());
        if(!resolved)throw new Error('Unresolved fixture module '+id);
        return load(resolved);
      }
      return require(id);
    };
    vm.runInThisContext('(function(exports,require,module,process){'+code+'\n})',{filename:file})(loadedModule.exports,dependency,loadedModule,{env:environment});
    if(file===path.join(root,'lib/staff-server.ts')) {
      const {StaffRequestError}=loadedModule.exports;
      loadedModule.exports.staffRequest=async(request,signal,access)=>{
        assert.ok(signal instanceof AbortSignal);signal.throwIfAborted();
        state.trace.push({op:'authorize',access});
        if(!state.valid||request.headers.get('authorization')!=='Bearer fixture-staff-token')throw new StaffRequestError('Sign in again.',401);
        if(request.headers.get('origin')!=='https://garyhome.vn')throw new StaffRequestError('Invalid origin.',403);
        if(!state.role||access==='manage'&&!['owner','admin','manager'].includes(state.role))throw new StaffRequestError('Active staff permission required.',403);
        return {user:{id:actor},role:state.role};
      };
    }
    return loadedModule.exports;
  }
  async function send(method='GET',body,options={}) {
    const request=new Request('https://garyhome.vn/api/admin/seo'+(options.query||''),{
      method,headers:{authorization:'Bearer fixture-staff-token',origin:'https://garyhome.vn','content-type':'application/json',...options.headers},
      ...(method==='GET'?{}:{body:options.raw??JSON.stringify(body)}),
    });
    return load(path.join(root,'app/api/admin/seo/route.ts'))[method](request);
  }
  async function cron(authorization='Bearer fixture-cron-secret') {
    const headers=authorization===undefined?{}:{authorization};
    return load(path.join(root,'app/api/cron/seo/route.ts')).POST(new Request('https://garyhome.vn/api/cron/seo',{method:'POST',headers}));
  }
  return {state,send,cron};
}
const writes=state=>state.trace.filter(event=>['start','advance','settings'].includes(event.op));

test('all staff audit endpoints authorize before accessing privileged audit services',async()=>{
  for(const method of ['GET','POST','PATCH'])for(const options of [{valid:false},{role:null}]){
    const h=endpoint(options),response=await h.send(method,method==='PATCH'?{weeklyEnabled:true,limits}:{action:'start'});
    assert.equal(response.status,options.valid===false?401:403);
    assert.deepEqual(h.state.trace,[{op:'authorize',access:method==='PATCH'?'manage':'view'}]);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
  }
  for(const headers of [{authorization:''},{origin:'https://untrusted.invalid'}]){
    const h=endpoint();assert.ok([401,403].includes((await h.send('POST',{action:'start'},{headers})).status));assert.equal(writes(h.state).length,0);assert.equal(h.state.trace.some(event=>event.op==='database'),false);
  }
});
test('editors can inspect, start and advance audits through fresh view authorization',async()=>{
  const h=endpoint();
  assert.equal((await h.send()).status,200);assert.equal((await h.send('POST',{action:'start'})).status,200);assert.equal((await h.send('POST',{action:'advance',runId})).status,200);
  assert.deepEqual(h.state.trace.filter(e=>e.op==='authorize').map(e=>e.access),['view','view','view']);
  assert.deepEqual(writes(h.state),[{op:'start',args:['manual',actor,undefined]},{op:'advance',args:[runId]}]);
  h.state.role=null;const before=h.state.trace.length;assert.equal((await h.send()).status,403);assert.deepEqual(h.state.trace.slice(before),[{op:'authorize',access:'view'}]);
});
test('individual rescans preserve the authorized actor and selected historical report',async()=>{
  const h=endpoint(),page='https://garyhome.vn/services';
  const response=await h.send('POST',{action:'start',url:page},{query:'?runId='+runId});assert.equal(response.status,200);
  assert.deepEqual(writes(h.state),[{op:'start',args:['page',actor,page]}]);assert.equal(h.state.trace.find(e=>e.op==='snapshot').id,runId);
});
test('weekly settings require current management permission on every PATCH',async()=>{
  const denied=endpoint();assert.equal((await denied.send('PATCH',{weeklyEnabled:true,limits})).status,403);assert.equal(denied.state.updates.length,0);assert.equal(denied.state.trace.some(e=>e.op==='database'),false);
  for(const role of ['owner','admin','manager']){
    const h=endpoint({role});assert.equal((await h.send('PATCH',{weeklyEnabled:true,limits})).status,200);assert.deepEqual(h.state.updates,[{weeklyEnabled:true,limits}]);assert.equal(h.state.trace[0].access,'manage');
    h.state.role='editor';assert.equal((await h.send('PATCH',{weeklyEnabled:false,limits})).status,403);assert.equal(h.state.updates.length,1);
  }
});
test('invalid audit commands and selection IDs fail before service writes',async()=>{
  for(const body of [{action:'delete'},{action:'advance',runId:'bad'},{action:'start',url:''},{action:'start',url:'a'.repeat(2049)},{action:'start',url:123}]){
    const h=endpoint();assert.equal((await h.send('POST',body)).status,400);assert.deepEqual(writes(h.state),[]);
  }
  for(const method of ['GET','POST']){
    const h=endpoint();assert.equal((await h.send(method,{action:'start'},{query:'?runId=invalid'})).status,400);assert.deepEqual(writes(h.state),[]);
  }
});
test('crawl settings reject unsafe limits and malformed JSON without persisting changes',async()=>{
  const invalidLimits=[{maxUrls:501},{maxUrls:0},{maxDepth:5},{concurrency:3},{requestIntervalMs:999},{timeoutMs:10001},{maxDurationMs:900001},{maxUrls:1.5}];
  for(const patch of invalidLimits){
    const h=endpoint({role:'manager'});assert.equal((await h.send('PATCH',{weeklyEnabled:true,limits:{...limits,...patch}})).status,400);assert.deepEqual(h.state.updates,[]);
  }
  const invalid=endpoint({role:'manager'});assert.equal((await invalid.send('PATCH',{weeklyEnabled:'true',limits})).status,400);assert.equal((await invalid.send('PATCH',undefined,{raw:'{broken'})).status,400);assert.equal((await invalid.send('PATCH',undefined,{raw:JSON.stringify({padding:'x'.repeat(5000)})})).status,413);assert.deepEqual(invalid.state.updates,[]);
});
test('cron rejects absent, wrong, malformed and Unicode-mismatched bearer secrets before any work',async()=>{
  for(const [options,authorization]of [[{secret:undefined},'Bearer fixture-cron-secret'],[{},''],[{},'Bearer incorrect-secret'],[{},'fixture-cron-secret'],[{},'Basic fixture-cron-secret'],[{secret:'x'},'Bearer é'],[{secret:'秘密'},'Bearer xx']]){
    const h=endpoint(options),response=await h.cron(authorization);assert.equal(response.status,401,JSON.stringify([options,authorization]));assert.deepEqual(h.state.trace,[]);assert.equal(response.headers.get('cache-control'),'private, no-store');
  }
});
test('authorized cron delegates the weekly due check and advances persisted work',async()=>{
  const h=endpoint({activeRun:{id:runId}}),response=await h.cron();assert.equal(response.status,200);assert.deepEqual(await response.json(),{active:true,runId});
  assert.deepEqual(h.state.trace,[{op:'start',args:['weekly']},{op:'advance',args:[]},{op:'database'},{op:'snapshot',id:undefined}]);
  const idle=endpoint();assert.deepEqual(await(await idle.cron()).json(),{active:false,runId:null});
});
test('cron failures return a bounded credential-free operational error',async()=>{
  const h=endpoint({serviceError:true}),response=await h.cron();assert.equal(response.status,503);assert.match((await response.json()).error,/Scheduled SEO audit failed/);assert.equal(h.state.trace.some(e=>e.op==='database'),false);
});
