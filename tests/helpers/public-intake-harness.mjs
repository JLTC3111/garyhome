import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as requests from '../../lib/requests.ts';

// Run the real server helper while replacing only its privileged database
// boundary. Tests can share a backend across independent simulated instances.
export function publicIntakeHarness({vercel=false,backend}={}){
 const state=backend||{calls:[],data:'90000000-0000-4000-8000-000000000001'};
 const admin={rpc(name,args){
  return {abortSignal(signal){
   if(!(signal instanceof AbortSignal))throw new Error('Missing RPC deadline');
   state.calls.push({name,args});
   if(state.throwError)return Promise.reject(state.throwError);
   return Promise.resolve(state.respond?state.respond(args):{data:state.data,error:state.error||null});
  }};
 }};
 const source=ts.transpileModule(fs.readFileSync(new URL('../../lib/public-intake.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const loaded={exports:{}};
 vm.runInThisContext('(function(exports,require,module,process){'+source+'\n})', {filename:'lib/public-intake.ts'})(loaded.exports,id=>{
  if(id==='./server')return {staffAdminClient:()=>state.unavailable?null:admin};
  if(id==='./requests')return requests;
  throw new Error('Unexpected public intake dependency: '+id);
 },loaded,{env:{VERCEL:vercel?'1':undefined}});
 return {savePublicIntake:loaded.exports.savePublicIntake,state};
}
