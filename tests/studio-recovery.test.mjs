import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from 'typescript';

const base=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(base,'package.json'));
const fixture={...JSON.parse(fs.readFileSync(path.join(base,'data/site-content.json'),'utf8')),properties:JSON.parse(fs.readFileSync(path.join(base,'data/properties.json'),'utf8'))};
const user=id=>({id,email:`${id}@example.invalid`,aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'});
const authSession=id=>({user:user(id),access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,token_type:'bearer'});
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};

// Load the real TSX components into React's test renderer. Substitute only the
// browser platform and network boundary; no production state logic is mocked.
async function harness(t, options={}){
 const descriptors=new Map();
 const setGlobal=(key,value)=>{descriptors.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});};
 const browser=new EventTarget(),page=Object.assign(new EventTarget(),{visibilityState:'visible',documentElement:{lang:'en'},body:{style:{overflow:''}}});
 const network={onLine:true},stored=new Map();
 setGlobal('IS_REACT_ACT_ENVIRONMENT',true);setGlobal('window',browser);setGlobal('document',page);setGlobal('navigator',network);
 setGlobal('localStorage',{getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)});
 setGlobal('fetch',async()=>Response.json({configured:true,url:'https://unit-test.invalid',publishableKey:'sb_publishable_fake'}));
 let session=authSession(options.customer?'customer':'owner'),callback;
 const backend={role:options.customer?null:'owner',roleError:false,pending:new Map(),writes:new Map(),upload:null,rows:{enquiries:[],customer_profiles:[],customer_records:[],saved_homes:[]},calls:[]};
 const client={
  auth:{getSession:async()=>backend.sessionRead?await backend.sessionRead.promise:({data:{session},error:null}),onAuthStateChange:handler=>{callback=handler;return {data:{subscription:{unsubscribe:()=>{callback=undefined;}}}};},signOut:async()=>{session=null;callback?.('SIGNED_OUT',null);return {error:null};}},
  storage:{from:()=>({upload:()=>backend.upload.promise,getPublicUrl:path=>({data:{publicUrl:'https://uploads.example.invalid/'+path}})})},
  from(table){
   let writing=false,payload,single=false;const filters={};const query={};
   for(const method of ['upsert','update','insert','delete'])query[method]=value=>{writing=true;payload=value;return query;};
   query.eq=(key,value)=>{filters[key]=value;return query;};
   for(const method of ['single','maybeSingle'])query[method]=()=>{single=true;return query;};
   for(const method of ['select','order','abortSignal','is'])query[method]=()=>query;
   query.then=(resolve,reject)=>{
    if(writing)backend.calls.push({table,payload});
    if(writing&&backend.writes.has(table))return backend.writes.get(table).promise.then(resolve,reject);
    if(backend.pending.has(table))return backend.pending.get(table).promise.then(resolve,reject);
    let rows=structuredClone(backend.rows[table]??fixture[table]??[]);
    if(Array.isArray(rows)&&filters.user_id)rows=rows.filter(row=>row.user_id===filters.user_id);
    if(single&&Array.isArray(rows))rows=rows[0]??null;
    const value=table==='team_members'?{data:backend.role?{role:backend.role}:null,error:backend.roleError?new Error('Offline'):null}:table==='site_settings'?{data:structuredClone(fixture.settings),error:null}:{data:writing?payload:rows,error:null};
    return Promise.resolve(value).then(resolve,reject);
   };
   return query;
  },
 };
 const modules=new Map();
 function load(file){
  if(modules.has(file))return modules.get(file).exports;
  if(file.endsWith('.json'))return JSON.parse(fs.readFileSync(file,'utf8'));
  const module={exports:{}};modules.set(file,module);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  function dependency(id){
   if(id==='next/link')return {__esModule:true,default:({href,children,...props})=>React.createElement('a',{...props,href},children)};
   if(id==='next/navigation')return {usePathname:()=>options.customer?'/account':'/admin'};
   if(id==='@/lib/browser-client')return {browserClient:()=>client};
   if(id.startsWith('.')||id.startsWith('@/')){
    const target=id.startsWith('@/')?path.join(base,id.slice(2)):path.resolve(path.dirname(file),id);
    const resolved=[target,target+'.tsx',target+'.ts',target+'.json'].find(x=>fs.existsSync(x)&&fs.statSync(x).isFile());
    assert.ok(resolved,`Import resolves: ${id}`);return load(resolved);
   }
   return require(id);
  }
  vm.runInThisContext('(function(exports,require,module,__filename,__dirname){'+source+'\n})',{filename:file})(module.exports,dependency,module,file,path.dirname(file));
  return module.exports;
 }
 const {SiteProvider,useSite}=load(path.join(base,'components/site-context.tsx'));
 const Page=options.customer?load(path.join(base,'components/account-page.tsx')).AccountPage:load(path.join(base,'components/admin-page.tsx')).AdminPage;
 let site,renderer;
 function Probe(){site=useSite();return null;}
 t.after(async()=>{
  if(renderer)await act(async()=>{renderer.unmount();});
  for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 });
 await act(async()=>{renderer=TestRenderer.create(React.createElement(SiteProvider,{initial:{content:structuredClone(fixture),configured:true,error:false}},React.createElement(React.Fragment,null,React.createElement(Probe),React.createElement(Page))));await delay(10);});
 await act(async()=>{await delay(5);});
 assert.equal(site.editor,!options.customer);
 const emit=async(next)=>{await act(async()=>{session=next;callback?.(next?'TOKEN_REFRESHED':'SIGNED_OUT',next);await delay(5);});};
 const editSettings=async(value)=>{
  await act(async()=>{renderer.root.findByProps({'aria-label':'Site settings'}).props.onClick();});
  await act(async()=>{renderer.root.findAllByType('textarea')[0].props.onChange({target:{value}});});
 };
 return {renderer,backend,network,browser,page,emit,editSettings,get site(){return site;}};
}

test('unsaved settings survive token refresh, offline/online recovery, and same-user reauthentication',async t=>{
 const h=await harness(t);await h.editSettings('Unsaved after a long idle');
 await h.emit(authSession('owner'));
 assert.equal(h.renderer.root.findAllByType('textarea')[0].props.value,'Unsaved after a long idle');
 await act(async()=>{h.network.onLine=false;h.browser.dispatchEvent(new Event('offline'));});
 assert.equal(h.site.sessionPhase,'offline');assert.equal(h.site.editor,true);
 await act(async()=>{h.network.onLine=true;h.browser.dispatchEvent(new Event('online'));await delay(5);});
 assert.equal(h.site.sessionPhase,'ready');assert.equal(h.renderer.root.findAllByType('textarea')[0].props.value,'Unsaved after a long idle');
 await h.emit(null);assert.equal(h.site.editor,false);assert.equal(h.renderer.root.findAllByType('textarea').length,0);
 await h.emit(authSession('owner'));
 assert.equal(h.renderer.root.findAllByType('textarea')[0].props.value,'Unsaved after a long idle');
});

test('transient permission checks keep forms mounted, while another account cannot inherit a draft',async t=>{
 const h=await harness(t);await h.editSettings('Owner private draft');
 h.backend.roleError=true;await h.emit(authSession('owner'));
 assert.equal(h.site.editor,true);assert.equal(h.site.sessionPhase,'error');
 assert.equal(h.renderer.root.findAllByType('textarea')[0].props.value,'Owner private draft');
 h.backend.roleError=false;await h.emit(null);await h.emit(authSession('another-editor'));
 assert.equal(h.site.editor,true);assert.notEqual(h.renderer.root.findAllByType('textarea')[0].props.value,'Owner private draft');
});

test('a slow background read cannot overwrite a completed local save',async t=>{
 const h=await harness(t),pending=deferred();h.backend.pending.set('properties',pending);
 let refreshing;
 await act(async()=>{refreshing=h.site.refresh();await delay(2);h.site.setContent(previous=>({...previous,settings:{...previous.settings,hero_title_en:'Saved after refresh began'}}));});
 pending.resolve({data:structuredClone(fixture.properties),error:null});
 await act(async()=>{await refreshing;});
 assert.equal(h.site.content.settings.hero_title_en,'Saved after refresh began');
});

test('a late private inbox read cannot repopulate the cache after sign-out',async t=>{
 const h=await harness(t),pending=deferred();h.backend.pending.set('enquiries',pending);
 let refreshing;await act(async()=>{refreshing=h.site.refresh();await delay(2);});
 await h.emit(null);pending.resolve({data:[{id:'old-private-message',message:'Private'}],error:null});
 await act(async()=>{await refreshing;});assert.deepEqual(h.site.enquiries,[]);assert.equal(h.site.user,null);
});

test('a write completing after an account change cannot commit client-side state',async t=>{
 const h=await harness(t),pending=deferred();let writing,started=false;
 await act(async()=>{writing=h.site.editorTask(()=>{started=true;return pending.promise;}).then(()=>null,error=>error);await delay(5);});
 assert.equal(started,true);await h.emit(null);pending.resolve({data:{id:'write-completed'}});
 let error;await act(async()=>{error=await writing;});assert.match(error.message,/account changed/);assert.equal(h.site.user,null);
});


test('edits made while a slow settings save is pending are retained as the next draft',async t=>{
 const h=await harness(t);await h.editSettings('Version submitted to the server');
 const pending=deferred();h.backend.writes.set('site_settings',pending);
 await act(async()=>{h.renderer.root.findByProps({className:'admin-panel settings-form editor-form'}).props.onSubmit({preventDefault(){}});await delay(5);});
 await act(async()=>{h.renderer.root.findAllByType('textarea')[0].props.onChange({target:{value:'New edits made while saving'}});});
 pending.resolve({data:{id:'main'},error:null});await act(async()=>{await delay(5);});
 assert.equal(h.site.content.settings.hero_title_en,'Version submitted to the server');
 assert.equal(h.renderer.root.findAllByType('textarea')[0].props.value,'New edits made while saving');
});


test('slow uploads preserve concurrent text edits and cannot attach photos to a different editor',async t=>{
 const h=await harness(t);
 const add=()=>h.renderer.root.findAllByType('button').find(button=>button.children.includes('Add a property'));
 const title=()=>h.renderer.root.findAllByType('input').find(input=>input.props.maxLength===200);
 const input=()=>h.renderer.root.findAllByType('input').find(input=>input.props.type==='file'&&input.props.multiple);
 await act(async()=>{add().props.onClick();});
 let uploading;h.backend.upload=deferred();
 await act(async()=>{uploading=input().props.onChange({target:{files:[{type:'image/jpeg',size:1000}]}});await delay(5);});
 await act(async()=>{title().props.onChange({target:{value:'Typed while uploading'}});});
 h.backend.upload.resolve({data:{path:'photo'},error:null});await act(async()=>{await uploading;});
 assert.equal(title().props.value,'Typed while uploading');assert.equal(h.renderer.root.findByProps({className:'editor-photo-grid'}).children.length,1);
 h.backend.upload=deferred();
 await act(async()=>{uploading=input().props.onChange({target:{files:[{type:'image/jpeg',size:1000}]}});await delay(5);});
 await act(async()=>{h.renderer.root.findByProps({'aria-label':'Close editor'}).props.onClick();});
 await act(async()=>{add().props.onClick();});
 h.backend.upload.resolve({data:{path:'late-photo'},error:null});await act(async()=>{await uploading;});
 assert.equal(title().props.value,'');assert.equal(h.renderer.root.findByProps({className:'editor-photo-grid'}).children.length,0);
});

test('customer profile drafts survive idle recovery and language changes without editor access',async t=>{
 const h=await harness(t,{customer:true});
 const button=label=>h.renderer.root.findAllByType('button').find(node=>node.children.includes(label));
 await act(async()=>{button('My details').props.onClick();});
 const name=()=>h.renderer.root.findAllByType('input').find(node=>node.props.autoComplete==='name');
 await act(async()=>{name().props.onChange({target:{value:'My unsaved customer name'}});});
 await h.emit(authSession('customer'));
 await act(async()=>{h.network.onLine=false;h.browser.dispatchEvent(new Event('offline'));});
 assert.equal(name().props.value,'My unsaved customer name');assert.equal(h.site.editor,false);
 await act(async()=>{h.network.onLine=true;h.browser.dispatchEvent(new Event('online'));await delay(10);h.site.setLanguage('vi');});
 assert.equal(h.site.sessionPhase,'ready');assert.equal(name().props.value,'My unsaved customer name');
 assert.match(JSON.stringify(h.renderer.toJSON()),/Thông tin của tôi/);
});

test('a customer write remains bound to its authenticated identity',async t=>{
 const h=await harness(t,{customer:true}),pending=deferred();let writing;
 await act(async()=>{writing=h.site.accountTask((_db,_signal,id)=>{assert.equal(id,'customer');return pending.promise;}).then(()=>null,error=>error);await delay(5);});
 await h.emit(authSession('different-customer'));pending.resolve({data:'old-result'});
 let error;await act(async()=>{error=await writing;});assert.match(error.message,/account changed/);assert.equal(h.site.user.id,'different-customer');
});

test('switching accounts during customer session recovery prevents the write from starting',async t=>{
 const h=await harness(t,{customer:true}),pending=deferred();h.backend.sessionRead=pending;
 let writing,started=false;
 await act(async()=>{writing=h.site.accountTask(()=>{started=true;return Promise.resolve('wrong-account-write');}).then(()=>null,error=>error);await delay(5);});
 await h.emit(authSession('different-customer'));
 pending.resolve({data:{session:authSession('customer')},error:null});
 let error;await act(async()=>{error=await writing;});
 assert.equal(started,false);assert.match(error.message,/account changed/);
});

test('switching accounts during editor recovery also prevents the write from starting',async t=>{
 const h=await harness(t),pending=deferred();h.backend.sessionRead=pending;
 let writing,started=false;
 await act(async()=>{writing=h.site.editorTask(()=>{started=true;return Promise.resolve('wrong-editor-write');}).then(()=>null,error=>error);await delay(5);});
 await h.emit(authSession('different-editor'));
 pending.resolve({data:{session:authSession('owner')},error:null});
 let error;await act(async()=>{error=await writing;});
 assert.equal(started,false);assert.match(error.message,/account changed/);
});

test('late customer enquiries cannot return after sign-out',async t=>{
 const h=await harness(t,{customer:true}),pending=deferred();h.backend.pending.set('enquiries',pending);
 await act(async()=>{await h.site.reconnect();await delay(5);});
 await h.emit(null);
 pending.resolve({data:[{id:'private-alice',message:'Private customer plans',kind:'general',status:'new',created_at:new Date().toISOString()}],error:null});
 await act(async()=>{await delay(5);});
 assert.doesNotMatch(JSON.stringify(h.renderer.toJSON()),/Private customer plans/);assert.equal(h.site.user,null);
});

test('saved-home reads from a previous account cannot overwrite the new account',async t=>{
 const h=await harness(t,{customer:true}),pending=deferred();h.backend.pending.set('saved_homes',pending);
 await act(async()=>{await h.site.reconnect();await delay(5);});
 h.backend.pending.delete('saved_homes');await h.emit(authSession('other-customer'));
 pending.resolve({data:[{property_id:'previous-account-favourite'}],error:null});
 await act(async()=>{await delay(5);});
 assert.deepEqual(h.site.saved,[]);assert.equal(h.site.savedReady,true);assert.equal(h.site.user.id,'other-customer');
});

test('customer edits made during a pending save remain as the next draft',async t=>{
 const h=await harness(t,{customer:true});
 const button=h.renderer.root.findAllByType('button').find(node=>node.children.includes('My details'));
 await act(async()=>{button.props.onClick();});
 const name=()=>h.renderer.root.findAllByType('input').find(node=>node.props.autoComplete==='name');
 await act(async()=>{name().props.onChange({target:{value:'Submitted customer name'}});});
 const pending=deferred();h.backend.writes.set('customer_profiles',pending);
 await act(async()=>{h.renderer.root.findByProps({className:'enquiry-form account-details-form'}).props.onSubmit({preventDefault(){}});await delay(5);});
 await act(async()=>{name().props.onChange({target:{value:'Typed while saving'}});});
 pending.resolve({data:{user_id:'customer',email:'customer@example.invalid',full_name:'Submitted customer name',phone:'',preferred_district:null,budget_min:null,budget_max:null,move_in_date:null,preferences:'',updated_at:new Date().toISOString()},error:null});
 await act(async()=>{await delay(10);});
 assert.equal(name().props.value,'Typed while saving');assert.equal(h.backend.calls.filter(call=>call.table==='customer_profiles').length,1);
});

test('staff can add a customer, keep a follow-up and search the directory',async t=>{
 const h=await harness(t);
 await act(async()=>{h.renderer.root.findByProps({'aria-label':'Customers'}).props.onClick();await delay(5);});
 const add=h.renderer.root.findAllByType('button').find(node=>node.children.includes('Add customer'));
 await act(async()=>{add.props.onClick();});
 const detail=()=>h.renderer.root.findByProps({'aria-label':'Customer details'});
 await act(async()=>{
  detail().findAllByType('input').find(node=>node.props.minLength===2).props.onChange({target:{value:'Customer QA'}});
 });
 await act(async()=>{detail().findByProps({type:'email'}).props.onChange({target:{value:'customer-qa@example.invalid'}});});
 await act(async()=>{detail().findByProps({type:'date'}).props.onChange({target:{value:'2026-12-01'}});});
 await act(async()=>{detail().findByType('textarea').props.onChange({target:{value:'Private follow-up note'}});});
 await act(async()=>{detail().findByType('form').props.onSubmit({preventDefault(){}});await delay(10);});
 assert.match(JSON.stringify(h.renderer.toJSON()),/Customer QA/);
 const write=h.backend.calls.find(call=>call.table==='customer_records');assert.equal(write.payload.follow_up_on,'2026-12-01');assert.equal(write.payload.notes,'Private follow-up note');
 await act(async()=>{h.renderer.root.findByProps({'aria-label':'Search customers'}).props.onChange({target:{value:'no match'}});});
 assert.doesNotMatch(JSON.stringify(h.renderer.toJSON()),/Customer QA/);
});
