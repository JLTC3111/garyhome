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
const fixture={...JSON.parse(fs.readFileSync(path.join(base,'data/site-content.json'),'utf8')),properties:JSON.parse(fs.readFileSync(path.join(base,'data/properties.json'),'utf8')),authors:[],activities:[]};
const user=id=>({id,email:`${id}@example.invalid`,aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'});
const authSession=id=>({user:user(id),access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,token_type:'bearer'});
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};

// Load the real TSX components into React's test renderer. Substitute only the
// browser platform and network boundary; no production state logic is mocked.
async function harness(t, options={}){
 const descriptors=new Map();
 const setGlobal=(key,value)=>{descriptors.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});};
 const browser=new EventTarget(),page=Object.assign(new EventTarget(),{visibilityState:'visible',documentElement:{lang:'en'},body:{style:{overflow:''}}});
 const network={onLine:!options.offline,userAgent:'Node.js',platform:'',maxTouchPoints:0},stored=new Map();
 browser.location=new URL(options.url??'https://gary.example/account');
 // Headless controls inspect DOM constructors even when test-renderer refs are null.
 class TestElement {} class TestHTMLElement extends TestElement {}
 Object.assign(browser,{Element:TestElement,HTMLElement:TestHTMLElement});
 setGlobal('Element',TestElement);setGlobal('HTMLElement',TestHTMLElement);
 setGlobal('IS_REACT_ACT_ENVIRONMENT',true);setGlobal('window',browser);setGlobal('document',page);setGlobal('navigator',network);
 setGlobal('localStorage',{getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)});
 setGlobal('FormData',class{constructor(form){this.form=form;}get(key){return this.form.fields?.[key]??null;}});
 setGlobal('fetch',async(input,init)=>{
  if(String(input).startsWith('/api/admin/team')){
   const method=init?.method??'GET';backend.teamCalls.push({method,input:init?.body?JSON.parse(init.body):null});
   if(method==='GET'){
    if(backend.teamPending)await backend.teamPending.promise;
    return Response.json({members:backend.teamRows,next:null,domains:['garyhome.com','icue.vn'],invitationsEnabled:true});
   }
   if(method==='POST'){const data=JSON.parse(init.body);backend.teamRows.push({user_id:'new-staff',display_name:data.full_name,email:data.email,role:data.role,active:true,confirmed:false});return Response.json({invited:true});}
   return Response.json({user_id:'changed-staff'});
  }
  if(String(input).endsWith('/auth/v1/user')){backend.passwordCalls.push({headers:new Headers(init.headers),body:JSON.parse(init.body)});return Response.json({});}
  return Response.json({configured:true,url:'https://unit-test.invalid',publishableKey:'sb_publishable_fake'});
 });
 let session=options.guest?null:authSession(options.customer?'customer':'owner'),callback;
 const backend={role:options.role??(options.customer||options.guest?null:'owner'),roleError:false,readErrors:new Map(Object.entries(options.readErrors??{})),pending:new Map(),writes:new Map(),upload:null,rows:{enquiries:[],customer_profiles:[],customer_records:[],saved_homes:[]},calls:[],publicCalls:[],publicError:options.publicError??false,publicPending:options.publicPending,publicRows:structuredClone(options.publicContent??fixture),sessionRead:options.authPending,authCalls:[],passwordCalls:[],teamCalls:[],teamRows:[{user_id:'owner',display_name:'Project Owner',email:'owner@protonmail.com',role:'owner',active:true,confirmed:true}]};
 const publicClient={from(table){
  const filters={},query={};
  query.eq=(key,value)=>{filters[key]=value;return query;};query.in=(key,value)=>{filters[key]=value;return query;};
  for(const method of ['select','order','abortSignal','single'])query[method]=()=>query;
  query.then=(resolve,reject)=>(async()=>{
   backend.publicCalls.push({table,filters});
   if(backend.publicPending)await backend.publicPending.promise;
   let data=structuredClone(table==='site_settings'?backend.publicRows.settings:table==='listing_authors'?backend.publicRows.authors||[]:table==='site_activities'?backend.publicRows.activities||[]:backend.publicRows[table]);
   if(table==='properties')data=data.filter(row=>row.status===filters.status);
   return backend.publicError?{data:null,error:{code:'',message:'Temporary network failure'},status:0}:{data,error:null,status:200};
  })().then(resolve,reject);
  return query;
 }};
 const client={
  auth:{getSession:async()=>backend.sessionRead?await backend.sessionRead.promise:({data:{session},error:null}),onAuthStateChange:handler=>{callback=handler;return {data:{subscription:{unsubscribe:()=>{callback=undefined;}}}};},signOut:async()=>{session=null;callback?.('SIGNED_OUT',null);return {error:null};},
   signUp:async input=>{backend.authCalls.push({method:'signup',input});return {data:{session:null},error:null};},
   signInWithPassword:async input=>{backend.authCalls.push({method:'password',input});session=authSession('customer');callback?.('SIGNED_IN',session);return {data:{session},error:null};},
   resetPasswordForEmail:async(...input)=>{backend.authCalls.push({method:'reset',input});return {error:null};},
  },
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
    if(!writing&&backend.readErrors.has(table))return Promise.resolve({data:null,error:backend.readErrors.get(table)}).then(resolve,reject);
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
  const loaded={exports:{}};modules.set(file,loaded);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  function dependency(id){
   if(id==='next/link')return {__esModule:true,default:({href,children,...props})=>React.createElement('a',{...props,href},children)};
   if(id==='next/navigation')return {usePathname:()=>options.path??(options.customer?'/account':'/admin')};
   if(id==='@/lib/browser-client')return {browserClient:()=>client,publicBrowserClient:()=>publicClient};
   if(id.startsWith('.')||id.startsWith('@/')){
    const target=id.startsWith('@/')?path.join(base,id.slice(2)):path.resolve(path.dirname(file),id);
    const resolved=[target,target+'.tsx',target+'.ts',target+'.json'].find(x=>fs.existsSync(x)&&fs.statSync(x).isFile());
    assert.ok(resolved,`Import resolves: ${id}`);return load(resolved);
   }
   return require(id);
  }
  vm.runInThisContext('(function(exports,require,module,__filename,__dirname){'+source+'\n})',{filename:file})(loaded.exports,dependency,loaded,file,path.dirname(file));
  return loaded.exports;
 }
 const {SiteProvider,useSite}=load(path.join(base,'components/site-context.tsx'));
 const Page=options.page==='password'||options.page==='invite'?load(path.join(base,'components/password-reset.tsx')).PasswordReset
  :options.page==='portals'?load(path.join(base,'components/portal-access.tsx')).PortalAccess
  :options.page==='header'?load(path.join(base,'components/site-shell.tsx')).Header
  :options.page==='staff'?load(path.join(base,'components/admin-page.tsx')).AdminPage
  :options.customer?load(path.join(base,'components/account-page.tsx')).AccountPage:load(path.join(base,'components/admin-page.tsx')).AdminPage;
 let site,renderer;
 function Probe(){site=useSite();return null;}
 t.after(async()=>{
  if(renderer)await act(async()=>{renderer.unmount();});
  for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 });
 await act(async()=>{renderer=TestRenderer.create(React.createElement(SiteProvider,{initial:{content:structuredClone(fixture),configured:true,error:!!options.initialError}},React.createElement(React.Fragment,null,React.createElement(Probe),options.publicOnly?null:React.createElement(Page,{invitation:options.page==='invite'}))));await delay(10);});
 await act(async()=>{await delay(5);});
 assert.equal(site.editor,!options.customer&&!options.guest&&!options.offline);
 const emit=async(next)=>{await act(async()=>{session=next;callback?.(next?'TOKEN_REFRESHED':'SIGNED_OUT',next);await delay(5);});};
 const editSettings=async(value)=>{
  await act(async()=>{renderer.root.findByProps({'aria-label':'Site settings'}).props.onClick();});
  await act(async()=>{renderer.root.findAllByType('textarea')[0].props.onChange({target:{value}});});
 };
 return {renderer,backend,network,browser,page,emit,editSettings,get site(){return site;}};
}

test('portal chooser identifies both destinations without changing authentication',async t=>{
 const h=await harness(t,{guest:true,page:'portals'});
 assert.deepEqual(h.renderer.root.findAllByType('h2').map(node=>node.children.join('')),['Customer portal','Staff portal']);
 assert.deepEqual(h.renderer.root.findAllByType('a').map(node=>node.props.href),['/account','/admin']);
 assert.match(JSON.stringify(h.renderer.toJSON()),/personal email/);
 assert.match(JSON.stringify(h.renderer.toJSON()),/assigned by an owner or administrator/);
 await act(async()=>{h.site.setLanguage('vi');});
 assert.deepEqual(h.renderer.root.findAllByType('h2').map(node=>node.children.join('')),['Cổng khách hàng','Cổng nhân viên']);
 assert.equal(h.site.user,null);assert.deepEqual(h.backend.authCalls,[]);assert.deepEqual(h.backend.calls,[]);
});

test('customer login identifies personal email and links to the separate staff portal in both languages',async t=>{
 const h=await harness(t,{customer:true,guest:true});
 assert.equal(h.renderer.root.findByType('form').props['aria-label'],'Customer account access');
 assert.match(JSON.stringify(h.renderer.toJSON()),/Personal email address/);
 const selected=()=>h.renderer.root.findByProps({className:'portal-switcher'}).findAllByType('a').filter(node=>node.props['aria-current']==='page');
 assert.equal(selected().length,1);assert.equal(selected()[0].props.href,'/account');
 assert.equal(h.renderer.root.findByProps({className:'account-team-link portal-other-link'}).props.href,'/admin');
 await act(async()=>{h.site.setLanguage('vi');});
 assert.equal(h.renderer.root.findByType('form').props['aria-label'],'Truy cập tài khoản khách hàng');
 assert.match(JSON.stringify(h.renderer.toJSON()),/Bạn là nhân viên/);
});

test('staff login explains assigned company access, retains owner sign-in and offers no registration',async t=>{
 const h=await harness(t,{guest:true,page:'staff'});
 assert.equal(h.renderer.root.findByType('form').props['aria-label'],'Staff account access');
 assert.match(JSON.stringify(h.renderer.toJSON()),/Use your assigned @garyhome.com or @icue.vn email/);
 assert.match(JSON.stringify(h.renderer.toJSON()),/Existing owner accounts are also supported/);
 assert.equal(h.renderer.root.findByProps({className:'portal-other-link'}).props.href,'/account');
 assert.equal(h.renderer.root.findAllByType('input').some(node=>node.props.name==='full_name'),false);
 const selected=h.renderer.root.findByProps({className:'portal-switcher'}).findAllByType('a').filter(node=>node.props['aria-current']==='page');
 assert.equal(selected.length,1);assert.equal(selected[0].props.href,'/admin');
 await act(async()=>{h.site.setLanguage('vi');});
 assert.equal(h.renderer.root.findByType('form').props['aria-label'],'Truy cập tài khoản nhân viên');
 await act(async()=>{await h.renderer.root.findByType('form').props.onSubmit({preventDefault(){},currentTarget:{fields:{email:'owner@protonmail.com',password:'Existing owner password'}}});await delay(5);});
 assert.equal(h.backend.authCalls[0].method,'password');assert.equal(h.backend.authCalls[0].input.email,'owner@protonmail.com');
 assert.equal(h.site.editor,false);assert.equal(h.backend.calls.length,0);
});

test('a customer opening staff login receives a customer return link without staff access',async t=>{
 const h=await harness(t,{customer:true,page:'staff'});
 assert.equal(h.renderer.root.findAllByType('form').length,0);
 assert.equal(h.renderer.root.findAllByProps({'aria-label':'CMS navigation'}).length,0);
 assert.equal(h.renderer.root.findByProps({className:'staff-account-choice'}).findByType('a').props.href,'/account');
 assert.match(JSON.stringify(h.renderer.toJSON()),/Sign out and use a staff account/);
 assert.equal(h.site.editor,false);assert.equal(h.site.staffRole,null);assert.deepEqual(h.backend.calls,[]);
 await act(async()=>{h.site.setLanguage('vi');});
 assert.match(JSON.stringify(h.renderer.toJSON()),/Mở cổng khách hàng/);
});

test('public navigation keeps favourites, customer and staff entry together and translates the brand',async t=>{
 const h=await harness(t,{guest:true,page:'header',path:'/login'});
 const band=h.renderer.root.findByProps({className:'top-strip-actions'});
 const customer=band.findAllByType('a').find(node=>node.props.className==='customer-login-link');
 const staff=band.findAllByType('a').find(node=>node.props.className==='staff-login-link');
 assert.equal(customer.props.href,'/account');assert.equal(customer.props['aria-label'],'Customer login');
 assert.equal(staff.props.href,'/admin');assert.equal(staff.props['aria-label'],'Staff login');
 const favourites=()=>band.findAllByType('button').find(node=>node.props.className==='favourites-trigger');
 assert.equal(favourites().props['aria-expanded'],false);
 assert.equal(h.renderer.root.findByProps({className:'brand-tagline'}).children.join(''),'HANOI RENTALS');
 await act(async()=>h.site.setLanguage('vi'));
 assert.equal(customer.props['aria-label'],'Khách hàng đăng nhập');assert.equal(staff.props['aria-label'],'Nhân viên đăng nhập');
 assert.equal(h.renderer.root.findByProps({className:'brand-tagline'}).children.join(''),'NHÀ CHO THUÊ HÀ NỘI');
 assert.equal(h.renderer.root.findByProps({className:'brand-tagline'}).props.lang,'vi');
 await h.emit(authSession('customer'));assert.equal(customer.props['aria-label'],'Tài khoản khách hàng');
 await h.emit(null);assert.equal(customer.props['aria-label'],'Khách hàng đăng nhập');
});

test('customer schema errors stay visible until a successful refresh loads real data',async t=>{
 const h=await harness(t,{customer:true,readErrors:{customer_profiles:{code:'PGRST205',message:'Missing table'}}});
 assert.match(JSON.stringify(h.renderer.toJSON()),/The customer portal is not available yet/);
 assert.equal(h.renderer.root.findAllByProps({className:'account-profile-nudge'}).length,0);
 h.backend.readErrors.clear();
 await act(async()=>{await h.renderer.root.findAllByType('button').find(node=>node.children.includes('Refresh')).props.onClick();await delay(15);});
 assert.equal(h.renderer.root.findAllByProps({role:'alert'}).length,0);
 assert.equal(h.renderer.root.findAllByProps({className:'account-profile-nudge'}).length,1);
 assert.equal(h.site.editor,false);assert.deepEqual(h.backend.calls,[]);
});

test('password recovery returns existing staff to Studio',async t=>{
 const token='header.'+Buffer.from(JSON.stringify({sub:'owner'})).toString('base64url')+'.signature';
 const h=await harness(t,{page:'password',url:'https://gary.example/auth/reset#type=recovery&access_token='+token});
 assert.equal(h.renderer.root.findByType('h1').children.join(''),'Reset staff password.');
 await act(async()=>{await h.renderer.root.findByType('form').props.onSubmit({preventDefault(){},currentTarget:{fields:{password:'A replacement owner password',confirm:'A replacement owner password'}}});});
 assert.equal(h.renderer.root.findByProps({className:'button'}).props.href,'/admin');
 assert.equal(h.backend.passwordCalls.length,1);
 assert.equal(h.backend.passwordCalls[0].headers.get('authorization'),'Bearer test-token');
});

test('personal email signup confirms the mailbox without staff access',async t=>{
 const h=await harness(t,{customer:true,guest:true});
 const button=label=>h.renderer.root.findAllByType('button').find(node=>node.children.includes(label));
 const labels=()=>h.renderer.root.findAllByType('button').map(node=>node.children.filter(child=>typeof child==='string').join('').trim());
 assert.deepEqual(labels(),['Sign in','Create an account','Forgot password?']);
 await act(async()=>{h.site.setLanguage('vi');});
 assert.deepEqual(labels(),['Đăng nhập','Tạo tài khoản','Quên mật khẩu?']);
 await act(async()=>{h.site.setLanguage('en');});
 await act(async()=>{button('Create an account').props.onClick();});
 assert.deepEqual(labels(),['Create account','Back to sign in']);
 const confirmation=h.renderer.root.findByProps({name:'confirm_password'});
 assert.equal(confirmation.props.type,'password');assert.equal(confirmation.props.required,true);
 assert.equal(confirmation.props.minLength,12);assert.equal(confirmation.props.autoComplete,'new-password');
 const fields={email:' personal@gmail.com ',password:'A long personal password',full_name:'New Customer',consent:'on'};
 const submit=confirm_password=>h.renderer.root.findByType('form').props.onSubmit({preventDefault(){},currentTarget:{fields:{...fields,confirm_password}}});
 await act(async()=>{await submit('A different personal password');});
 assert.deepEqual(h.backend.authCalls,[]);assert.equal(button('Create account').props.disabled,false);
 assert.match(JSON.stringify(h.renderer.toJSON()),/The passwords don’t match/);
 await act(async()=>{h.site.setLanguage('vi');});
 assert.match(JSON.stringify(h.renderer.toJSON()),/Xác nhận mật khẩu/);
 await act(async()=>{await submit('');});
 assert.deepEqual(h.backend.authCalls,[]);assert.match(JSON.stringify(h.renderer.toJSON()),/Mật khẩu không khớp/);
 await act(async()=>{h.site.setLanguage('en');});
 await act(async()=>{await submit(fields.password);});
 const signup=h.backend.authCalls[0];assert.equal(signup.method,'signup');assert.equal(signup.input.email,'personal@gmail.com');
 assert.equal(h.backend.authCalls.length,1);assert.equal(signup.input.password,fields.password);
 assert.equal(signup.input.options.emailRedirectTo,'https://gary.example/account');
 assert.deepEqual(signup.input.options.data,{full_name:'New Customer'});assert.equal(h.site.user,null);assert.equal(h.site.staffRole,null);
 assert.match(JSON.stringify(h.renderer.toJSON()),/Check your inbox to confirm your email/);
});

test('personal email password login opens the customer account and never grants staff membership',async t=>{
 const h=await harness(t,{customer:true,guest:true});
 assert.equal(h.renderer.root.findAllByProps({name:'confirm_password'}).length,0);
 await act(async()=>{await h.renderer.root.findByType('form').props.onSubmit({preventDefault(){},currentTarget:{fields:{email:'personal@gmail.com',password:'A long personal password'}}});await delay(5);});
 assert.equal(h.backend.authCalls[0].method,'password');assert.equal(h.site.user.id,'customer');assert.equal(h.site.editor,false);assert.equal(h.site.staffRole,null);
});

test('customer email recovery keeps the reset destination and releases the translated form',async t=>{
 const h=await harness(t,{customer:true,guest:true});
 const button=label=>h.renderer.root.findAllByType('button').find(node=>node.children.includes(label));
 await act(async()=>{button('Forgot password?').props.onClick();h.site.setLanguage('vi');});
 assert.equal(h.renderer.root.findAllByType('input').filter(node=>node.props.type==='password').length,0);
 await act(async()=>{await h.renderer.root.findByType('form').props.onSubmit({preventDefault(){},currentTarget:{fields:{email:' customer@example.invalid '}}});});
 assert.deepEqual(h.backend.authCalls,[{method:'reset',input:['customer@example.invalid',{redirectTo:'https://gary.example/auth/reset'}]}]);
 assert.equal(button('Gửi liên kết').props.disabled,false);
 assert.match(JSON.stringify(h.renderer.toJSON()),/Hãy kiểm tra hộp thư/);
 assert.equal(h.site.user,null);assert.equal(h.site.staffRole,null);
});

test('password setup requires the matching email link and rejects an account switch',async t=>{
 const token='header.'+Buffer.from(JSON.stringify({sub:'customer'})).toString('base64url')+'.signature';
 const h=await harness(t,{customer:true,page:'invite',url:'https://gary.example/auth/invite#type=invite&access_token='+token});
 assert.equal(h.renderer.root.findAllByType('form').length,1);
 await h.emit(authSession('other-account'));
 assert.equal(h.renderer.root.findAllByType('form').length,0);assert.match(JSON.stringify(h.renderer.toJSON()),/account changed/);
 assert.equal(h.backend.passwordCalls.length,0);
});

test('opening staff password setup without an invitation cannot change an existing session password',async t=>{
 const h=await harness(t,{customer:true,page:'invite'});
 assert.equal(h.renderer.root.findAllByType('form').length,0);assert.equal(h.backend.passwordCalls.length,0);
 assert.match(JSON.stringify(h.renderer.toJSON()),/Open the staff invitation link/);
});

test('owner team invitations preserve their draft through language changes and idle recovery',async t=>{
 const h=await harness(t);
 await act(async()=>{h.renderer.root.findByProps({'aria-label':'Team access'}).props.onClick();await delay(5);});
 const form=()=>h.renderer.root.findByProps({className:'admin-panel enquiry-form team-invite-form'});
 await act(async()=>{form().findByProps({name:'full_name'}).props.onChange({target:{value:'New Colleague'}});});
 await act(async()=>{form().findByProps({name:'email'}).props.onChange({target:{value:'new@garyhome.com'}});h.site.setLanguage('vi');});
 await h.emit(authSession('owner'));
 await h.emit(null);await h.emit(authSession('owner'));
 assert.equal(form().findByProps({name:'full_name'}).props.value,'New Colleague');assert.equal(form().findByProps({name:'email'}).props.value,'new@garyhome.com');
 await act(async()=>{await form().props.onSubmit({preventDefault(){}});await delay(5);});
 const create=h.backend.teamCalls.find(call=>call.method==='POST');assert.equal(create.input.email,'new@garyhome.com');assert.equal(create.input.role,'editor');
 assert.match(JSON.stringify(h.renderer.toJSON()),/New Colleague/);
 assert.ok(h.backend.teamCalls.length<10,'Directory reads must not loop through session recovery');
});

test('staff roles can use Studio without seeing owner/admin team management',async t=>{
 const h=await harness(t,{role:'editor'});
 assert.equal(h.site.editor,true);assert.equal(h.site.staffRole,'editor');
 assert.equal(h.renderer.root.findAllByProps({'aria-label':'Team access'}).length,0);
 assert.equal(h.backend.teamCalls.length,0);
});

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

test('a failed server reload automatically recovers public listings and clears the warning for guests',async t=>{
 const live=structuredClone(fixture);live.settings.hero_title_en='Live content recovered after reload';
 const h=await harness(t,{guest:true,publicOnly:true,initialError:true,publicContent:live});
 assert.equal(h.site.backendError,false);
 assert.equal(h.site.content.settings.hero_title_en,live.settings.hero_title_en);
 assert.equal(h.renderer.root.findAllByProps({className:'service-banner'}).length,0);
 assert.equal(h.backend.publicCalls.length,5);
 assert.deepEqual(h.backend.publicCalls.find(call=>call.table==='properties').filters,{status:'published',listing_type:'rent',availability:['available','on_request']});
 assert.equal(h.site.user,null);
});

test('failed public recovery keeps a translated warning and coalesces retries until live data arrives',async t=>{
 const h=await harness(t,{guest:true,publicOnly:true,initialError:true,publicError:true});
 assert.equal(h.site.backendError,true);assert.equal(h.backend.publicCalls.length,5);
 await act(async()=>{h.site.setLanguage('vi');});
 assert.match(JSON.stringify(h.renderer.toJSON()),/Không thể cập nhật tin đăng/);
 const retry=h.renderer.root.findAllByType('button').find(button=>button.children.includes('Thử lại'));
 assert.ok(retry);assert.equal(retry.props.disabled,false);
 const gate=deferred();h.backend.publicPending=gate;h.backend.publicError=false;
 let first,second;
 await act(async()=>{retry.props.onClick();first=h.site.reconnect();second=h.site.reconnect();await delay(5);});
 assert.equal(h.backend.publicCalls.length,10);
 assert.match(JSON.stringify(h.renderer.toJSON()),/Đang cập nhật tin đăng/);
 gate.resolve();await act(async()=>{await Promise.all([first,second]);await delay(5);});
 assert.equal(h.site.backendError,false);assert.equal(h.renderer.root.findAllByProps({className:'service-banner'}).length,0);
});

test('an offline reload waits for the online event before recovering public content',async t=>{
 const h=await harness(t,{guest:true,publicOnly:true,initialError:true,offline:true});
 assert.equal(h.site.backendError,true);assert.equal(h.backend.publicCalls.length,0);
 await act(async()=>{h.network.onLine=true;h.browser.dispatchEvent(new Event('online'));await delay(10);});
 assert.equal(h.backend.publicCalls.length,5);assert.equal(h.site.backendError,false);
});

test('Studio refresh clears the fallback warning and a late public read cannot replace drafts or unsaved edits',async t=>{
 const gate=deferred(),h=await harness(t,{initialError:true,publicPending:gate});
 assert.equal(h.site.backendError,false);
 const draft={...structuredClone(fixture.properties[0]),id:'staff-only-draft',status:'draft'};
 h.backend.rows.properties=[draft,...structuredClone(fixture.properties)];
 await act(async()=>{await h.site.refresh();});
 await h.editSettings('Unsaved settings during public recovery');
 gate.resolve();await act(async()=>{await delay(5);});
 assert.ok(h.site.content.properties.some(property=>property.id===draft.id));
 assert.equal(h.renderer.root.findAllByType('textarea')[0].props.value,'Unsaved settings during public recovery');
 await h.emit(null);
 assert.ok(!h.site.content.properties.some(property=>property.id===draft.id));
});

test('sign-out uses recovered public content instead of restoring the original reference data',async t=>{
 const live=structuredClone(fixture);live.settings.hero_title_en='Latest public home page';
 const h=await harness(t,{customer:true,publicOnly:true,initialError:true,publicContent:live});
 assert.equal(h.site.content.settings.hero_title_en,live.settings.hero_title_en);
 await h.emit(null);
 assert.equal(h.site.content.settings.hero_title_en,live.settings.hero_title_en);assert.equal(h.site.backendError,false);
});

test('healthy public reloads and session recovery do not make redundant content requests',async t=>{
 const h=await harness(t,{guest:true,publicOnly:true});
 await act(async()=>{await h.site.reconnect();});
 assert.equal(h.backend.publicCalls.length,0);assert.equal(h.site.backendError,false);
});

test('public listing recovery does not wait for a stalled login session',async t=>{
 const gate=deferred(),h=await harness(t,{customer:true,publicOnly:true,initialError:true,authPending:gate});
 assert.equal(h.site.sessionPhase,'checking');assert.equal(h.site.backendError,false);assert.equal(h.backend.publicCalls.length,5);
 gate.resolve({data:{session:authSession('customer')},error:null});
 await act(async()=>{await delay(5);});assert.equal(h.site.sessionPhase,'ready');
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
