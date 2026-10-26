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
const fixture={...JSON.parse(fs.readFileSync(path.join(base,'data/site-content.json'),'utf8')),properties:JSON.parse(fs.readFileSync(path.join(base,'data/properties.json'),'utf8')),editorial:JSON.parse(fs.readFileSync(path.join(base,'data/editorial.json'),'utf8')),authors:[],activities:[]};
const user=id=>({id,email:`${id}@example.invalid`,aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'});
const authSession=id=>({user:user(id),access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,token_type:'bearer'});
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};

// Load the real TSX components into React's test renderer. Substitute only the
// browser platform and network boundary; no production state logic is mocked.
async function harness(t, options={}){
 const descriptors=new Map();
 const setGlobal=(key,value)=>{descriptors.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});};
 const browser=new EventTarget(),page=Object.assign(new EventTarget(),{visibilityState:'visible',documentElement:{lang:'en'},body:{style:{overflow:''}}});
 const network={onLine:!options.offline,userAgent:'Node.js',platform:'',maxTouchPoints:0},stored=new Map(Object.entries(options.storage||{}));
 browser.location=new URL(options.url??'https://gary.example/account');
 browser.history={state:null,replaceState(_state,_title,url){browser.location=new URL(url,browser.location);}};
 // Headless controls inspect DOM constructors even when test-renderer refs are null.
 class TestElement {} class TestHTMLElement extends TestElement {}
 Object.assign(browser,{Element:TestElement,HTMLElement:TestHTMLElement});
 setGlobal('Element',TestElement);setGlobal('HTMLElement',TestHTMLElement);
 setGlobal('IS_REACT_ACT_ENVIRONMENT',true);setGlobal('window',browser);setGlobal('document',page);setGlobal('navigator',network);
 setGlobal('localStorage',{getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)});
 setGlobal('FormData',class{constructor(form){this.form=form;}get(key){return this.form.fields?.[key]??null;}});
 setGlobal('fetch',async(input,init)=>{
  if(String(input).startsWith('/api/admin/team')){
   const method=String(input).endsWith('/reset-password')?'RESET':String(input).endsWith('/set-password')?'PASSWORD':init?.method??'GET';backend.teamCalls.push({method,input:init?.body?JSON.parse(init.body):null});
   if(method==='RESET')return Response.json({ok:true});
   if(method==='PASSWORD')return backend.teamPasswordError?Response.json({error:backend.teamPasswordError},{status:503}):Response.json({ok:true,password_set:true,confirmed:true});
   if(method==='DELETE'){backend.teamRows=backend.teamRows.filter(m=>m.user_id!==JSON.parse(init.body).user_id);return Response.json({ok:true});}
   if(method==='GET'){
    if(backend.teamPending)await backend.teamPending.promise;
    return Response.json({members:backend.teamRows,next:null,domains:['garyhome.com','icue.vn','gmail.com'],directCreationEnabled:true});
   }
   if(method==='POST'){if(backend.teamPostError)return Response.json(backend.teamPostError,{status:409});const data=JSON.parse(init.body),existing=backend.teamRows.some(m=>m.email.toLowerCase()===data.email.trim().toLowerCase());if(!existing)backend.teamRows.push({user_id:'new-staff',display_name:data.full_name,email:data.email,role:data.role,active:true,confirmed:false});if(existing)backend.teamRows=backend.teamRows.map(m=>m.email.toLowerCase()===data.email.toLowerCase()?{...m,confirmed:true}:m);return Response.json(backend.teamResult??{created:data.mode!=='assign',confirmed:true,...(data.replace_password?{password_set:true}:{})});}
   return Response.json({user_id:'changed-staff'});
  }
  if(String(input)==='/api/landlords'){
   const body=JSON.parse(init.body);backend.landlordCalls??=[];backend.landlordCalls.push({body,headers:new Headers(init.headers)});
   if(body.action==='prepare')return Response.json({permit:'test-permit',expires:Date.now()+7200000,url:'https://unit-test.invalid',key:'public-test-key',files:body.files.map((file,i)=>({...file,id:'test-file-'+i,path:'test-submission/'+i+'.png',token:'scoped-token'}))});
   if(backend.landlordFinalError)return Response.json({error:'connection'},{status:503});return Response.json({ok:true,id:'test-submission'},{status:201});
  }
  if(String(input)==='/api/enquiries'){backend.enquiryPosts??=[];backend.enquiryPosts.push({data:JSON.parse(init.body),headers:new Headers(init.headers)});return Response.json({ok:true},{status:201});}
  if(String(input).endsWith('/auth/v1/user')){backend.passwordCalls.push({headers:new Headers(init.headers),body:JSON.parse(init.body)});return backend.passwordError?Response.json({message:'Auth unavailable'},{status:503}):Response.json({});}
  return Response.json({configured:true,url:'https://unit-test.invalid',publishableKey:'sb_publishable_fake'});
 });
 let session=options.guest?null:authSession(options.customer?'customer':'owner'),callback;
 const backend={role:options.role??(options.customer||options.guest?null:'owner'),roleError:false,readErrors:new Map(Object.entries(options.readErrors??{})),pending:new Map(),writes:new Map(),writeErrors:new Map(),upload:null,rows:{editorial_articles:structuredClone(fixture.editorial),enquiries:[],customer_profiles:[],customer_records:[],saved_homes:[]},calls:[],publicCalls:[],publicError:options.publicError??false,publicPending:options.publicPending,publicRows:structuredClone(options.publicContent??fixture),sessionRead:options.authPending,authCalls:[],passwordCalls:[],navigation:[],rpcCalls:[],rpcPending:new Map(),teamCalls:[],teamRows:[{user_id:'owner',display_name:'Project Owner',email:'owner@protonmail.com',role:'owner',active:true,confirmed:true}]};
 const publicClient={from(table){
  const filters={},query={};
  query.eq=(key,value)=>{filters[key]=value;return query;};query.in=(key,value)=>{filters[key]=value;return query;};
  for(const method of ['select','order','abortSignal','single','limit'])query[method]=()=>query;
  query.then=(resolve,reject)=>(async()=>{
   backend.publicCalls.push({table,filters});
   if(backend.publicPending)await backend.publicPending.promise;
   let data=structuredClone(table==='site_settings'?backend.publicRows.settings:table==='listing_authors'?backend.publicRows.authors||[]:table==='site_activities'?backend.publicRows.activities||[]:table==='property_display_orders'?[]:table==='editorial_articles'?backend.publicRows.editorial||[]:backend.publicRows[table]);
   if(table==='properties')data=data.filter(row=>row.status===filters.status);
   return backend.publicError?{data:null,error:{code:'',message:'Temporary network failure'},status:0}:{data,error:null,status:200};
  })().then(resolve,reject);
  return query;
 }};
 const client={
  auth:{getSession:async()=>backend.sessionRead?await backend.sessionRead.promise:({data:{session},error:null}),onAuthStateChange:handler=>{callback=handler;return {data:{subscription:{unsubscribe:()=>{callback=undefined;}}}};},signOut:async()=>{session=null;callback?.('SIGNED_OUT',null);return {error:null};},
   signUp:async input=>{backend.authCalls.push({method:'signup',input});return {data:{session:null},error:null};},
   signInWithPassword:async input=>{backend.authCalls.push({method:'password',input});if(backend.signInError)return {data:{session:null},error:backend.signInError};session=authSession('customer');callback?.('SIGNED_IN',session);return {data:{session},error:null};},
   verifyOtp:async input=>{backend.authCalls.push({method:'verify',input});if(backend.verifyError)return {data:{session:null,user:null},error:backend.verifyError};session=authSession(options.verifyUser??'invited-staff');callback?.(input.type==='recovery'?'PASSWORD_RECOVERY':'SIGNED_IN',session);const verified=session;if(backend.verifySwitch){session=authSession('other-account');callback?.('SIGNED_IN',session);}return {data:{session:verified,user:verified.user},error:null};},
   resetPasswordForEmail:async(...input)=>{backend.authCalls.push({method:'reset',input});return {error:null};},
  },
  rpc(name,args){const q={abortSignal:()=>q,then(resolve,reject){backend.rpcCalls.push({name,args});if(name==='get_staff_profile')return Promise.resolve({data:{user_id:session?.user.id,display_name:'Test staff',avatar_path:backend.profilePaths?.get(session?.user.id)||'',password_change_reminder:backend.passwordReminder||false},error:null}).then(resolve,reject);if(name==='acknowledge_staff_password_reminder')backend.passwordReminder=false;if(name==='mark_studio_notifications_read')backend.notifications=backend.notifications?.map(n=>({...n,unread:false}));if(name==='get_studio_notifications')return Promise.resolve({data:{items:backend.notifications??[],unread_count:backend.notifications?.filter(n=>n.unread).length||0},error:null}).then(resolve,reject);if(name==='staff_photo_directory')return Promise.resolve({data:[],error:null}).then(resolve,reject);if(backend.rpcPending.has(name))return backend.rpcPending.get(name).promise.then(resolve,reject);if(name==='delete_property')backend.rows.properties=(backend.rows.properties??fixture.properties).filter(p=>p.id!==args.target_property);if(name==='delete_enquiry')backend.rows.enquiries=backend.rows.enquiries.filter(e=>e.id!==args.target_enquiry);return Promise.resolve({data:name==='mark_enquiry_read'?{read_at:'2026-10-25T01:02:03Z',read_by:session?.user.id}:true,error:null}).then(resolve,reject);}};return q;},
  storage:{from:()=>({upload:()=>backend.upload.promise,getPublicUrl:path=>({data:{publicUrl:'https://uploads.example.invalid/'+path}})})},
  from(table){
   let writing=false,payload,single=false,writeMethod;const filters={};const query={};
   for(const method of ['upsert','update','insert','delete'])query[method]=value=>{writing=true;writeMethod=method;payload=value;return query;};
   query.eq=(key,value)=>{filters[key]=value;return query;};
   for(const method of ['single','maybeSingle'])query[method]=()=>{single=true;return query;};
   for(const method of ['select','order','abortSignal','is','limit','or'])query[method]=()=>query;
   query.then=(resolve,reject)=>{
    if(writing)backend.calls.push({table,payload,method:writeMethod,filters});
    if(!writing){backend.privateReads??=[];backend.privateReads.push(table);}
    if(writing&&table==='staff_profiles'){backend.profilePaths??=new Map();backend.profilePaths.set(payload.user_id,payload.avatar_path);}
    if(writing&&backend.writeErrors.has(table))return Promise.resolve({data:null,error:backend.writeErrors.get(table)}).then(resolve,reject);
    if(writing&&backend.writes.has(table))return backend.writes.get(table).promise.then(resolve,reject);
    if(writing&&table==='saved_homes'){
     const items=Array.isArray(payload)?payload:payload?[payload]:[];if(writeMethod==='upsert'||writeMethod==='insert')for(const item of items)if(!backend.rows.saved_homes.some(row=>row.user_id===item.user_id&&row.property_id===item.property_id))backend.rows.saved_homes.push(item);
     if(writeMethod==='delete')backend.rows.saved_homes=backend.rows.saved_homes.filter(row=>row.user_id!==filters.user_id||row.property_id!==filters.property_id);
    }
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
   if(id==='next/navigation')return {usePathname:()=>options.path??(options.customer?'/account':'/admin'),useSearchParams:()=>browser.location.searchParams,useRouter:()=>({back(){},push(){},replace(target){backend.navigation.push(target);browser.location=new URL(target,browser.location);}})};
   if(id==='@supabase/supabase-js')return {createClient:()=>({storage:{from:()=>({uploadToSignedUrl:async(path,token,file)=>{backend.privateUploads??=[];backend.privateUploads.push({path,token,name:file.name});return {error:backend.privateUploadError===file.name?{statusCode:'503'}:null};}})}})};
   if(id==='@/lib/browser-client')return {browserClient:()=>{if(options.clearHashOnClient)browser.location.hash='';return client;},publicBrowserClient:()=>publicClient};
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
 const Page=options.page==='password'||options.page==='invite'||options.page==='callback'?load(path.join(base,'components/password-reset.tsx')).PasswordReset
  :options.page==='portals'?load(path.join(base,'components/portal-access.tsx')).PortalAccess
  :options.page==='header'?load(path.join(base,'components/site-shell.tsx')).Header
  :options.page==='staff'?load(path.join(base,'components/admin-page.tsx')).AdminPage
  :options.page==='contact'?load(path.join(base,'components/content-pages.tsx')).ContactPage
  :options.page==='services'?load(path.join(base,'components/about-sections.tsx')).ServicesPage
  :options.page==='tips'?load(path.join(base,'components/about-sections.tsx')).TipsPage
  :options.page==='landlords'?load(path.join(base,'components/about-sections.tsx')).LandlordsPage
  :options.customer?load(path.join(base,'components/account-page.tsx')).AccountPage:load(path.join(base,'components/admin-page.tsx')).AdminPage;
 let site,renderer;
 function Probe(){site=useSite();return null;}
 t.after(async()=>{
  if(renderer)await act(async()=>{renderer.unmount();});
  for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 });
 const render=showPage=>React.createElement(SiteProvider,{initial:{content:structuredClone(fixture),configured:true,error:!!options.initialError}},React.createElement(React.Fragment,null,React.createElement(Probe),options.publicOnly||!showPage?null:React.createElement(Page,{invitation:options.page==='invite'||options.page==='callback',articles:options.editorialPageRows})));
 await act(async()=>{renderer=TestRenderer.create(render(!options.deferPage));await delay(10);});
 await act(async()=>{await delay(5);});
 assert.equal(site.editor,!options.customer&&!options.guest&&!options.offline);
 const emit=async(next)=>{await act(async()=>{session=next;callback?.(next?'TOKEN_REFRESHED':'SIGNED_OUT',next);await delay(5);});};
 const editSettings=async(value)=>{
  await act(async()=>{renderer.root.findByProps({'aria-label':'Site settings'}).props.onClick();});
  await act(async()=>{renderer.root.findAllByType('textarea')[0].props.onChange({target:{value}});});
 };
 const mountPage=async()=>{await act(async()=>{renderer.update(render(true));await delay(5);});};
 const emitEvent=async(event,next)=>{await act(async()=>{session=next;callback?.(event,next);await delay(5);});};
 return {renderer,backend,network,browser,page,stored,emit,emitEvent,mountPage,editSettings,get site(){return site;}};
}

test('portal chooser identifies both destinations without changing authentication',async t=>{
 const h=await harness(t,{guest:true,page:'portals'});
 assert.deepEqual(h.renderer.root.findAllByType('h2').map(node=>node.children.join('')),['Customer portal','Staff portal']);
 assert.deepEqual(h.renderer.root.findAllByType('a').map(node=>node.props.href),['/account','/admin']);
 assert.match(JSON.stringify(h.renderer.toJSON()),/personal email/);
 assert.match(JSON.stringify(h.renderer.toJSON()),/assigned by a higher-level team member/);
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

test('staff login explains assigned company or Gmail access, retains owner sign-in and offers no registration',async t=>{
 const h=await harness(t,{guest:true,page:'staff'});
 assert.equal(h.renderer.root.findByType('form').props['aria-label'],'Staff account access');
 assert.match(JSON.stringify(h.renderer.toJSON()),/Use your assigned company or Gmail address/);
 assert.match(JSON.stringify(h.renderer.toJSON()),/Staff email \/ owner account/);
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

test('public navigation restores separate customer and staff controls with mobile access inside the menu',async t=>{
 const h=await harness(t,{guest:true,page:'header',path:'/login'}),band=h.renderer.root.findByProps({className:'top-strip-actions'}),logins=band.findAllByType('a').filter(node=>['/account','/admin'].includes(node.props.href));
 assert.deepEqual(logins.map(n=>n.props.href),['/account','/admin']);assert.deepEqual(logins.map(n=>n.props['aria-label']),['Customer account','Staff login']);assert.ok(logins.every(n=>n.props.className.includes('desktop-band-control')));
 const mobile=h.renderer.root.findByProps({className:'mobile-nav-tools'});assert.deepEqual(mobile.findAllByType('a').map(node=>node.props.href),['/account','/admin']);assert.equal(mobile.findAllByType('button').filter(n=>n.props.role==='switch').length,1);
 const toggle=()=>h.renderer.root.findAllByType('button').find(node=>node.props['aria-controls']==='site-navigation');await act(async()=>toggle().props.onClick());assert.equal(toggle().props['aria-expanded'],true);await act(async()=>mobile.findAllByType('a')[0].props.onClick());assert.equal(toggle().props['aria-expanded'],false);
 assert.equal(h.renderer.root.findByProps({className:'brand-tagline'}).children.join(''),'HANOI RENTALS');await act(async()=>h.site.setLanguage('vi'));assert.equal(logins[0].props['aria-label'],'Tài khoản khách hàng');assert.equal(logins[1].props['aria-label'],'Đăng nhập nhân viên');assert.equal(h.renderer.root.findByProps({className:'brand-tagline'}).children.join(''),'NHÀ CHO THUÊ HÀ NỘI');await h.emit(authSession('customer'));assert.equal(logins[0].props.href,'/account');assert.equal(logins[0].findAllByType('img').length,0);
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
 const labels=()=>h.renderer.root.findAllByType('button').map(node=>node.children.filter(child=>typeof child==='string').join('').trim()).filter(Boolean);
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
 assert.equal(h.renderer.root.findAllByProps({name:'password'}).length,0);assert.match(JSON.stringify(h.renderer.toJSON()),/account changed/);
 assert.equal(h.backend.passwordCalls.length,0);
});

test('opening staff password setup without an invitation cannot change an existing session password',async t=>{
 const h=await harness(t,{customer:true,page:'invite'});
 assert.equal(h.renderer.root.findAllByProps({name:'password'}).length,0);assert.equal(h.backend.passwordCalls.length,0);
 assert.match(JSON.stringify(h.renderer.toJSON()),/Open the staff invitation link/);
});

test('owner team drafts survive language changes and same-user recovery while temporary passwords clear after sign-out',async t=>{
 const h=await harness(t);
 await act(async()=>{h.renderer.root.findByProps({'aria-label':'Team access'}).props.onClick();await delay(5);});
 const form=()=>h.renderer.root.findByProps({className:'admin-panel enquiry-form team-invite-form'});
 await act(async()=>{form().findByProps({name:'full_name'}).props.onChange({target:{value:'New Colleague'}});});
 await act(async()=>{form().findByProps({name:'email'}).props.onChange({target:{value:'new@garyhome.com'}});h.site.setLanguage('vi');});
 await h.emit(authSession('owner'));
 await h.emit(null);await h.emit(authSession('owner'));
 assert.equal(form().findByProps({name:'full_name'}).props.value,'New Colleague');assert.equal(form().findByProps({name:'email'}).props.value,'new@garyhome.com');
 assert.equal(form().findByProps({name:'password'}).props.value,'');
 await act(async()=>{form().findByProps({name:'password'}).props.onChange({target:{value:'A temporary colleague password'}});form().findByProps({name:'confirm_password'}).props.onChange({target:{value:'A temporary colleague password'}});});
 await act(async()=>{await form().props.onSubmit({preventDefault(){}});await delay(5);});
 const create=h.backend.teamCalls.find(call=>call.method==='POST');assert.equal(create.input.email,'new@garyhome.com');assert.equal(create.input.role,'editor');
 assert.match(JSON.stringify(h.renderer.toJSON()),/New Colleague/);
 assert.ok(h.backend.teamCalls.length<10,'Directory reads must not loop through session recovery');
});

test('staff roles can use Studio and a read-only team directory',async t=>{
 const h=await harness(t,{role:'editor'});
 assert.equal(h.site.editor,true);assert.equal(h.site.staffRole,'editor');
 assert.equal(h.renderer.root.findAllByProps({'aria-label':'Team access'}).length,1);
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
 assert.equal(h.backend.publicCalls.length,7);
 assert.deepEqual(h.backend.publicCalls.find(call=>call.table==='properties').filters,{status:'published',listing_type:'rent',availability:['available','on_request']});
 assert.equal(h.site.user,null);
});

test('failed public recovery keeps a translated warning and coalesces retries until live data arrives',async t=>{
 const h=await harness(t,{guest:true,publicOnly:true,initialError:true,publicError:true});
 assert.equal(h.site.backendError,true);assert.equal(h.backend.publicCalls.length,7);
 await act(async()=>{h.site.setLanguage('vi');});
 assert.match(JSON.stringify(h.renderer.toJSON()),/Không thể cập nhật tin đăng/);
 const retry=h.renderer.root.findAllByType('button').find(button=>button.children.includes('Thử lại'));
 assert.ok(retry);assert.equal(retry.props.disabled,false);
 const gate=deferred();h.backend.publicPending=gate;h.backend.publicError=false;
 let first,second;
 await act(async()=>{retry.props.onClick();first=h.site.reconnect();second=h.site.reconnect();await delay(5);});
 assert.equal(h.backend.publicCalls.length,14);
 assert.match(JSON.stringify(h.renderer.toJSON()),/Đang cập nhật tin đăng/);
 gate.resolve();await act(async()=>{await Promise.all([first,second]);await delay(5);});
 assert.equal(h.site.backendError,false);assert.equal(h.renderer.root.findAllByProps({className:'service-banner'}).length,0);
});

test('an offline reload waits for the online event before recovering public content',async t=>{
 const h=await harness(t,{guest:true,publicOnly:true,initialError:true,offline:true});
 assert.equal(h.site.backendError,true);assert.equal(h.backend.publicCalls.length,0);
 await act(async()=>{h.network.onLine=true;h.browser.dispatchEvent(new Event('online'));await delay(10);});
 assert.equal(h.backend.publicCalls.length,7);assert.equal(h.site.backendError,false);
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
 assert.equal(h.site.sessionPhase,'checking');assert.equal(h.site.backendError,false);assert.equal(h.backend.publicCalls.length,7);
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


test('a reset form mounted after Supabase clears the hash retains the intended email-link identity',async t=>{
 const token='header.'+Buffer.from(JSON.stringify({sub:'owner'})).toString('base64url')+'.signature';
 const h=await harness(t,{page:'password',deferPage:true,clearHashOnClient:true,url:'https://gary.example/auth/reset#type=recovery&access_token='+token});
 assert.equal(h.browser.location.hash,'');assert.deepEqual(h.site.passwordLink,{type:'recovery',userId:'owner'});
 await h.mountPage();assert.equal(h.renderer.root.findAllByType('form').length,1);
 await act(async()=>{await h.renderer.root.findByType('form').props.onSubmit({preventDefault(){},currentTarget:{fields:{password:'An updated account password',confirm:'An updated account password'}}});});
 assert.equal(h.backend.passwordCalls.length,1);assert.match(JSON.stringify(h.renderer.toJSON()),/Your password is ready/);
});
test('PASSWORD_RECOVERY navigates a fallback root redirect to the reset form without losing the session',async t=>{
 const h=await harness(t,{customer:true,page:'password',guest:true,url:'https://gary.example/'});
 assert.equal(h.renderer.root.findAllByProps({name:'password'}).length,0);
 await h.emitEvent('PASSWORD_RECOVERY',authSession('customer'));
 assert.deepEqual(h.backend.navigation,['/auth/reset']);assert.equal(h.browser.location.pathname,'/auth/reset');
 assert.equal(h.renderer.root.findAllByType('form').length,1);assert.deepEqual(h.site.passwordLink,{type:'recovery',userId:'customer'});
 await h.emit(authSession('another-customer'));assert.equal(h.renderer.root.findAllByProps({name:'password'}).length,0);
 assert.equal(h.backend.passwordCalls.length,0);
});
test('opening an enquiry persists read state and preserves a note edited while the read request is pending',async t=>{
 const h=await harness(t),pending=deferred();h.backend.rpcPending.set('mark_enquiry_read',pending);
 const enquiry={id:'read-test',property_id:fixture.properties[0].id,name:'Read Test',kind:'viewing',intent:'rent',source:'website',email:'customer@gmail.com',message:'A viewing please',phone:'',status:'new',notes:'',created_at:'2026-10-25T00:00:00Z',read_at:null};
 h.backend.rows.enquiries=[enquiry];
 await act(async()=>{h.site.setEnquiries([enquiry]);h.renderer.root.findByProps({'aria-label':'Enquiries'}).props.onClick();});
 const row=()=>h.renderer.root.findAllByType('button').find(n=>n.props.className==='enquiry-row');
 assert.equal(row().props['data-unread'],true);
 await act(async()=>row().props.onClick());
 assert.equal(h.backend.rpcCalls.filter(c=>c.name==='mark_enquiry_read').length,1);
 await act(async()=>h.renderer.root.findAllByType('textarea').find(n=>n.props.maxLength===8000).props.onChange({target:{value:'Keep this concurrent private note'}}));
 await act(async()=>{pending.resolve({data:{read_at:'2026-10-25T01:02:03Z',read_by:'owner'},error:null});await delay(5);});
 assert.equal(row().props['data-unread'],false);assert.equal(h.site.enquiries[0].status,'new');
 assert.equal(h.renderer.root.findAllByType('textarea').find(n=>n.props.maxLength===8000).props.value,'Keep this concurrent private note');
 const requestCount=h.backend.rpcCalls.filter(c=>c.name==='mark_enquiry_read').length;
 await act(async()=>h.renderer.root.findByProps({'aria-label':'Close editor'}).props.onClick());
 await act(async()=>row().props.onClick());assert.equal(h.backend.rpcCalls.filter(c=>c.name==='mark_enquiry_read').length,requestCount,'Already-read enquiries need no repeated writes');
});
test('listing deletion requires explicit confirmation, removes the listing and is unavailable to editors',async t=>{
 const h=await harness(t);
 await act(async()=>h.renderer.root.findByProps({'aria-label':'Listings'}).props.onClick());
 const target=h.site.content.properties[0].id;
 const deleteButton=h.renderer.root.findAllByType('button').find(n=>n.props.className==='text-danger');assert.ok(deleteButton);
 await act(async()=>deleteButton.props.onClick());assert.equal(h.backend.rpcCalls.filter(c=>c.name==='delete_property').length,0);
 const dialog=h.renderer.root.findByType('dialog');assert.equal(dialog.props.role,'alertdialog');
 await act(async()=>{await dialog.findAllByType('button').find(n=>n.props.className==='button button-danger').props.onClick();await delay(5);});
 assert.equal(h.backend.rpcCalls.find(c=>c.name==='delete_property').name,'delete_property');assert.equal(h.backend.rpcCalls.find(c=>c.name==='delete_property').args.target_property,target);
 assert.ok(!h.site.content.properties.some(p=>p.id===target));
 await h.emit(null);assert.ok(!h.site.content.properties.some(p=>p.id===target));
 assert.equal(h.backend.rpcCalls.filter(c=>c.name==='delete_property').length,1);
});
test('editors can read enquiries but cannot see destructive listing or enquiry actions',async t=>{
 const h=await harness(t,{role:'editor'});
 await act(async()=>h.renderer.root.findByProps({'aria-label':'Listings'}).props.onClick());
 assert.equal(h.renderer.root.findAllByType('button').some(n=>n.props.className==='text-danger'),false);
});


test('a stale property editor updates its original record and cannot insert a listing removed by another session',async t=>{
 const h=await harness(t);await act(async()=>h.renderer.root.findByProps({'aria-label':'Listings'}).props.onClick());
 const target=h.site.content.properties[0].id;
 await act(async()=>h.renderer.root.findAllByType('button').find(n=>n.children.includes('Edit')).props.onClick());
 h.backend.writeErrors.set('properties',{code:'PGRST116',message:'No row found'});
 await act(async()=>h.site.setContent(c=>({...c,properties:c.properties.filter(p=>p.id!==target)})));
 await act(async()=>{await h.renderer.root.findByProps({className:'editor-form'}).props.onSubmit({preventDefault(){}});await delay(5);});
 const write=h.backend.calls.find(c=>c.table==='properties');assert.equal(write.method,'update');assert.equal(write.filters.id,target);
 assert.ok(!h.site.content.properties.some(p=>p.id===target));assert.match(JSON.stringify(h.renderer.toJSON()),/This listing no longer exists/);
});


test('Team access routes reset requests separately and confirms membership-only deletion for assigned Gmail staff',async t=>{
 const h=await harness(t);h.backend.teamRows.push({user_id:'gmail-staff',display_name:'Assigned Gmail Staff',email:'assigned@gmail.com',role:'editor',active:true,confirmed:true});
 await act(async()=>{h.renderer.root.findByProps({'aria-label':'Team access'}).props.onClick();await delay(5);});
 // Resolve the staff row by its email, independent of translated action copy.
 const row=h.renderer.root.findAllByProps({className:'team-member'}).find(n=>n.findAllByType('span').some(s=>s.children.includes('assigned@gmail.com')));assert.ok(row);
 await act(async()=>{await row.findAllByType('button').find(n=>n.props.className==='text-link team-reset-action').props.onClick();await delay(5);});
 assert.deepEqual(h.backend.teamCalls.filter(c=>c.method==='RESET'),[{method:'RESET',input:{user_id:'gmail-staff'}}]);
 assert.equal(h.backend.teamCalls.filter(c=>c.method==='POST').length,0);
 await act(async()=>row.findAllByType('button').find(n=>n.props.className==='text-link text-danger').props.onClick());
 const dialog=h.renderer.root.findByType('dialog');assert.match(JSON.stringify(h.renderer.toJSON()),/customer account and customer history are preserved/);
 await act(async()=>{await dialog.findAllByType('button').find(n=>n.props.className==='button button-danger').props.onClick();await delay(5);});
 assert.deepEqual(h.backend.teamCalls.filter(c=>c.method==='DELETE'),[{method:'DELETE',input:{user_id:'gmail-staff'}}]);
 assert.equal(h.backend.teamRows.some(m=>m.user_id==='gmail-staff'),false);
 assert.equal(h.renderer.root.findAllByProps({className:'team-member'}).length,1);
});


test('the reported expired callback shows a translated recovery form and never permits a password write',async t=>{
 const h=await harness(t,{guest:true,page:'callback',url:'http://127.0.0.1:3000/auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb='});
 assert.equal(h.renderer.root.findByType('h1').children.join(''),'Your email link has expired.');assert.equal(h.renderer.root.findAllByProps({name:'password'}).length,0);
 const form=()=>h.renderer.root.findByProps({className:'enquiry-form password-resend-form'});
 await act(async()=>form().findByProps({name:'email'}).props.onChange({target:{value:' Staff@gmail.com '}}));
 await act(async()=>{await form().props.onSubmit({preventDefault(){}});});
 assert.deepEqual(h.backend.authCalls,[{method:'reset',input:['staff@gmail.com',{redirectTo:'http://127.0.0.1:3000/auth/reset'}]}]);
 assert.match(JSON.stringify(h.renderer.toJSON()),/Use only the newest link/);assert.equal(h.backend.passwordCalls.length,0);
 await act(async()=>h.site.setLanguage('vi'));assert.equal(h.renderer.root.findByType('h1').children.join(''),'Liên kết email đã hết hạn.');assert.equal(form().findByProps({name:'email'}).props.value,' Staff@gmail.com ');
});
test('custom invitation links wait for explicit confirmation, scrub the token URL and then show password plus confirmation',async t=>{
 const token='a'.repeat(64),h=await harness(t,{guest:true,page:'invite',url:'https://gary.example/auth/invite#token_hash='+token+'&type=invite'});
 assert.equal(h.backend.authCalls.length,0);assert.equal(h.browser.location.hash,'');assert.equal(h.renderer.root.findAllByProps({name:'password'}).length,0);
 const confirm=()=>h.renderer.root.findByProps({className:'button password-verify-button'});
 await act(async()=>{await confirm().props.onClick();await delay(8);});
 assert.deepEqual(h.backend.authCalls,[{method:'verify',input:{type:'invite',token_hash:token}}]);
 assert.equal(h.renderer.root.findByProps({name:'password'}).props.type,'password');assert.equal(h.renderer.root.findByProps({name:'confirm'}).props.minLength,12);
 assert.deepEqual(h.site.passwordLink,{type:'invite',userId:'invited-staff'});
 await act(async()=>{await h.renderer.root.findByProps({className:'enquiry-form password-create-form'}).props.onSubmit({preventDefault(){},currentTarget:{fields:{password:'A private staff password',confirm:'A private staff password'}}});});
 assert.equal(h.backend.passwordCalls.length,1);assert.equal(h.backend.passwordCalls[0].headers.get('authorization'),'Bearer test-token');
 assert.equal(h.renderer.root.findByProps({className:'button'}).props.href,'/admin');
});
test('custom token verification errors offer a new link without granting a password form',async t=>{
 const h=await harness(t,{guest:true,page:'invite',url:'https://gary.example/auth/invite?type=invite&token_hash='+'b'.repeat(64)});h.backend.verifyError={code:'otp_expired'};
 await act(async()=>{await h.renderer.root.findByProps({className:'button password-verify-button'}).props.onClick();await delay(5);});
 assert.equal(h.renderer.root.findAllByProps({name:'password'}).length,0);assert.equal(h.site.passwordLink,null);assert.equal(h.backend.passwordCalls.length,0);
 assert.equal(h.renderer.root.findByType('h1').children.join(''),'Your email link has expired.');assert.equal(h.browser.location.search,'');
});
test('switching accounts during custom verification cannot bind setup to the wrong user',async t=>{
 const h=await harness(t,{guest:true,page:'invite',url:'https://gary.example/auth/invite#type=invite&token_hash='+'c'.repeat(64)});h.backend.verifySwitch=true;
 await act(async()=>{await h.renderer.root.findByProps({className:'button password-verify-button'}).props.onClick();await delay(5);});
 assert.equal(h.site.passwordLink,null);assert.equal(h.renderer.root.findAllByProps({name:'password'}).length,0);assert.equal(h.backend.passwordCalls.length,0);
});


test('a custom staff link landing on the homepage retains verification while routing to setup',async t=>{
 const h=await harness(t,{guest:true,page:'invite',deferPage:true,url:'https://gary.example/#type=invite&token_hash='+'d'.repeat(64)});
 assert.deepEqual(h.backend.navigation,['/auth/invite']);assert.equal(h.browser.location.pathname,'/auth/invite');assert.equal(h.browser.location.hash,'');assert.equal(h.backend.authCalls.length,0);
 await h.mountPage();assert.equal(h.renderer.root.findAllByProps({className:'button password-verify-button'}).length,1);
 await act(async()=>h.site.setLanguage('vi'));assert.match(JSON.stringify(h.renderer.toJSON()),/Tiếp tục đặt mật khẩu/);assert.equal(h.backend.authCalls.length,0);
});
test('a connection failure during verification releases the action and permits an explicit retry',async t=>{
 const h=await harness(t,{guest:true,page:'invite',url:'https://gary.example/auth/invite#type=invite&token_hash='+'e'.repeat(64)});h.backend.verifyError={code:'unexpected_failure'};
 const confirm=()=>h.renderer.root.findByProps({className:'button password-verify-button'});
 await act(async()=>{await confirm().props.onClick();await delay(5);});
 assert.equal(confirm().props.disabled,false);assert.equal(h.backend.authCalls.length,1);assert.equal(h.renderer.root.findAllByProps({name:'password'}).length,0);
 h.backend.verifyError=null;
 await act(async()=>{await confirm().props.onClick();await delay(5);});
 assert.equal(h.backend.authCalls.length,2);assert.equal(h.renderer.root.findAllByProps({name:'password'}).length,1);
});


test('existing staff assignments preserve their login and recovery email remains an explicit separate action',async t=>{
 const h=await harness(t);h.backend.teamRows.push({user_id:'pending-staff',display_name:'Pending Staff',email:'pending@gmail.com',role:'editor',active:true,confirmed:false});
 h.backend.teamResult={created:false,confirmed:true};
 await act(async()=>{h.renderer.root.findByProps({'aria-label':'Team access'}).props.onClick();await delay(5);});
 const form=()=>h.renderer.root.findByProps({className:'admin-panel enquiry-form team-invite-form'});
 await act(async()=>h.renderer.root.findAllByType('button').find(n=>n.children.includes('Assign existing login')).props.onClick());
 await act(async()=>{form().findByProps({name:'full_name'}).props.onChange({target:{value:'Pending Staff'}});});
 await act(async()=>{form().findByProps({name:'email'}).props.onChange({target:{value:'pending@gmail.com'}});});
 await act(async()=>{await form().props.onSubmit({preventDefault(){}});await delay(5);});
 assert.match(JSON.stringify(h.renderer.toJSON()),/existing login password is unchanged/);assert.equal(h.backend.teamCalls.filter(c=>c.method==='RESET').length,0);
 assert.equal(h.backend.teamRows.length,2);assert.equal(h.backend.teamCalls.filter(c=>c.method==='POST').length,1);
 const pending=h.renderer.root.findAllByProps({className:'team-member'}).find(n=>n.findAllByType('span').some(s=>s.children.includes('pending@gmail.com')));
 const resend=pending.findAllByType('button').find(n=>n.props.className==='text-link team-reset-action');assert.equal(resend.props.disabled,false);assert.ok(resend.children.includes('Send password link'));
 await act(async()=>{await resend.props.onClick();await delay(5);});
 assert.equal(h.backend.teamCalls.filter(c=>c.method==='RESET').length,1);assert.equal(h.backend.teamCalls.filter(c=>c.method==='POST').length,1);
 assert.match(JSON.stringify(h.renderer.toJSON()),/Password link requested/);
});

test('managers receive Staff-only creation choices and a translated role guide',async t=>{
 const h=await harness(t,{role:'manager'});
 await act(async()=>{h.renderer.root.findByProps({'aria-label':'Team access'}).props.onClick();await delay(5);});
 const form=h.renderer.root.findByProps({className:'admin-panel enquiry-form team-invite-form'});
 const roles=form.findAllByType(require('@base-ui/react/select').Select.Root)[0].props.items.map(item=>item.value);assert.deepEqual(roles,['editor']);
 assert.equal(form.findByProps({name:'password'}).props.autoComplete,'new-password');assert.equal(form.findByProps({name:'confirm_password'}).props.minLength,12);
 const guide=h.renderer.root.findByProps({className:'admin-panel team-permissions-guide'});assert.equal(guide.findAllByType('tbody')[0].findAllByType('tr').length,4);
 await act(async()=>h.site.setLanguage('vi'));assert.match(JSON.stringify(h.renderer.toJSON()),/Ai có thể tạo vai trò nào/);
});
test('staff can change their own password from the sidebar and clear the first-login reminder without email',async t=>{
 const h=await harness(t);h.backend.passwordReminder=true;
 await act(async()=>{await h.site.refreshStaffProfile();});
 assert.equal(h.renderer.root.findAllByProps({className:'staff-password-reminder'}).length,1);
 await act(async()=>h.renderer.root.findByProps({'aria-label':'Edit staff profile'}).props.onClick());
 const form=h.renderer.root.findByProps({className:'enquiry-form staff-password-form'});
 await act(async()=>{form.findByProps({name:'password'}).props.onChange({target:{value:'A new personal staff password'}});form.findByProps({name:'confirm_password'}).props.onChange({target:{value:'A new personal staff password'}});});
 await act(async()=>{await form.props.onSubmit({preventDefault(){}});await delay(5);});
 assert.equal(h.backend.passwordCalls.length,1);assert.equal(h.renderer.root.findAllByProps({className:'staff-password-reminder'}).length,0);assert.deepEqual(h.backend.authCalls,[]);
 assert.match(JSON.stringify(h.renderer.toJSON()),/Profile changes saved. Your password has been updated/);assert.equal(h.renderer.root.findAllByType('dialog').length,0);
});
test('profile upload persists a staff-owned path and the sidebar follows the saved photo',async t=>{
 const h=await harness(t);h.backend.upload=deferred();
 await act(async()=>h.renderer.root.findByProps({'aria-label':'Edit staff profile'}).props.onClick());
 const upload=h.renderer.root.findAllByType('input').find(n=>n.props.type==='file');
 await act(async()=>{upload.props.onChange({target:{files:[{type:'image/png',size:1024,name:'portrait.png'}],value:'portrait.png'}});await delay(5);});
 await act(async()=>{h.backend.upload.resolve({data:{path:'stored'},error:null});await delay(8);});
 const write=h.backend.calls.find(c=>c.table==='staff_profiles');assert.equal(write.payload.user_id,'owner');assert.match(write.payload.avatar_path,/^owner\/[a-f0-9-]+\.png$/);
 assert.equal(h.site.staffProfile.avatar_path,write.payload.avatar_path);
 const button=h.renderer.root.findByProps({'aria-label':'Edit staff profile'});assert.ok(button.findByType('img').props.src.endsWith(write.payload.avatar_path));
 const toast=h.renderer.root.findByType('dialog').findByProps({className:'staff-profile-toast'});assert.equal(toast.props.role,'status');assert.match(JSON.stringify(h.renderer.toJSON()),/Profile photo updated/);
 await act(async()=>h.site.setLanguage('vi'));assert.match(JSON.stringify(h.renderer.toJSON()),/Đã cập nhật ảnh hồ sơ/);
 const form=h.renderer.root.findByProps({className:'enquiry-form staff-password-form'});assert.equal(form.findByProps({name:'password'}).props.required,undefined);
 await act(async()=>{await form.props.onSubmit({preventDefault(){}});await delay(5);});assert.equal(h.backend.passwordCalls.length,0);assert.equal(h.renderer.root.findAllByType('dialog').length,0);assert.match(JSON.stringify(h.renderer.toJSON()),/Đã lưu thay đổi hồ sơ/);
});
test('notifications load once per refresh, show persisted activity and keep read state',async t=>{
 const h=await harness(t);h.backend.notifications=[{id:'notice-one',category:'team',action:'team.role_changed',actor_name:'Owner',actor_user_id:'owner',target_name:'Team colleague',target_user_id:'staff',target_role:'editor',details:{from:'manager',to:'editor'},created_at:'2026-10-25T00:00:00Z',unread:true}];
 const trigger=h.renderer.root.findByProps({className:'icon-button studio-notification-trigger'});
 await act(async()=>{trigger.props.onClick();await delay(5);});
 assert.equal(h.renderer.root.findByProps({className:'studio-notification-panel'}).props.role,'dialog');assert.match(JSON.stringify(h.renderer.toJSON()),/Role changed/);
 const reads=h.backend.rpcCalls.filter(c=>c.name==='get_studio_notifications').length;assert.ok(reads<5,'Background role recovery must not cause a notification read loop');
 const mark=h.renderer.root.findAllByType('button').find(n=>n.children.includes('Mark all read'));
 await act(async()=>{await mark.props.onClick();await delay(5);});assert.equal(h.renderer.root.findAllByProps({className:'notification-count'}).length,0);
 await act(async()=>h.site.setLanguage('vi'));assert.match(JSON.stringify(h.renderer.toJSON()),/Hoạt động & thông báo/);
 const event=new Event('keydown');Object.defineProperty(event,'key',{value:'Escape'});await act(async()=>h.browser.dispatchEvent(event));assert.equal(h.renderer.root.findAllByProps({className:'studio-notification-panel'}).length,0);
});


test('existing staff passwords can be replaced explicitly without assigning a role, sending an email or switching the owner session',async t=>{
 const h=await harness(t);h.backend.teamRows.push({user_id:'existing-staff',display_name:'Existing colleague',email:'colleague@gmail.com',role:'manager',active:true,confirmed:true});
 await act(async()=>{h.renderer.root.findByProps({'aria-label':'Team access'}).props.onClick();await delay(5);});
 const row=h.renderer.root.findAllByProps({className:'team-member'}).find(n=>n.findAllByType('span').some(s=>s.children.includes('colleague@gmail.com')));
 await act(async()=>row.findByProps({className:'text-link team-password-action'}).props.onClick());
 let dialog=h.renderer.root.findByType('dialog');assert.match(JSON.stringify(dialog.toJSON?.()??h.renderer.toJSON()),/current password/);
 const form=()=>h.renderer.root.findByType('dialog').findByType('form');
 await act(async()=>{form().findByProps({name:'temporary_password'}).props.onChange({target:{value:'A replacement temporary password'}});form().findByProps({name:'confirm_temporary_password'}).props.onChange({target:{value:'Does not match'}});});
 await act(async()=>{await form().props.onSubmit({preventDefault(){}});});assert.equal(h.backend.teamCalls.filter(c=>c.method==='PASSWORD').length,0);
 await act(async()=>{form().findByProps({name:'confirm_temporary_password'}).props.onChange({target:{value:'A replacement temporary password'}});});
 await act(async()=>{await form().props.onSubmit({preventDefault(){}});await delay(5);});
 assert.deepEqual(h.backend.teamCalls.filter(c=>c.method==='PASSWORD'),[{method:'PASSWORD',input:{user_id:'existing-staff',password:'A replacement temporary password',confirm_password:'A replacement temporary password'}}]);
 assert.equal(h.backend.teamCalls.filter(c=>c.method==='RESET'||c.method==='POST'||c.method==='PATCH').length,0);assert.equal(h.renderer.root.findAllByType('dialog').length,0);assert.equal(h.site.user.id,'owner');assert.equal(h.backend.authCalls.length,0);assert.equal(h.backend.teamRows.find(m=>m.user_id==='existing-staff').role,'manager');
});
test('temporary-password failures keep the form open and private passwords clear on role change',async t=>{
 const h=await harness(t);h.backend.teamRows.push({user_id:'existing-staff',display_name:'Existing colleague',email:'colleague@gmail.com',role:'editor',active:true,confirmed:true});
 await act(async()=>{h.renderer.root.findByProps({'aria-label':'Team access'}).props.onClick();await delay(5);});
 const row=h.renderer.root.findAllByProps({className:'team-member'}).find(n=>n.findAllByType('span').some(s=>s.children.includes('colleague@gmail.com')));
 await act(async()=>row.findByProps({className:'text-link team-password-action'}).props.onClick());
 const form=()=>h.renderer.root.findByType('dialog').findByType('form');
 await act(async()=>{form().findByProps({name:'temporary_password'}).props.onChange({target:{value:'Private unsaved temporary password'}});form().findByProps({name:'confirm_temporary_password'}).props.onChange({target:{value:'Private unsaved temporary password'}});});
 h.backend.teamPasswordError='Couldn’t confirm the temporary password. Check the account before trying again.';
 await act(async()=>{await form().props.onSubmit({preventDefault(){}});await delay(5);});assert.equal(h.backend.teamCalls.filter(c=>c.method==='PASSWORD').length,1);assert.match(JSON.stringify(h.renderer.toJSON()),/Couldn’t confirm the temporary password/);
 h.backend.role='manager';await h.emit(authSession('owner'));assert.equal(h.renderer.root.findAllByType('dialog').length,0);assert.equal(h.renderer.root.findAllByProps({name:'temporary_password'}).length,0);
});
test('the staff portal normalizes email, preserves exact password characters and explains existing-account credentials in both languages',async t=>{
 const h=await harness(t,{guest:true,page:'staff'});h.backend.signInError=Object.assign(new Error('Invalid login credentials'),{code:'invalid_credentials'});
 const fields={email:'  COLLEAGUE@GMAIL.COM  ',password:'  An exact temporary password  '};
 await act(async()=>{await h.renderer.root.findByProps({'aria-label':'Staff account access'}).props.onSubmit({preventDefault(){},currentTarget:{fields}});});
 assert.deepEqual(h.backend.authCalls,[{method:'password',input:{email:'colleague@gmail.com',password:fields.password}}]);assert.equal(h.site.user,null);assert.match(JSON.stringify(h.renderer.toJSON()),/Reassigned accounts keep their existing password/);assert.match(JSON.stringify(h.renderer.toJSON()),/no separate first-time login page/);
 await act(async()=>h.site.setLanguage('vi'));assert.match(JSON.stringify(h.renderer.toJSON()),/Tài khoản được cấp lại quyền/);assert.match(JSON.stringify(h.renderer.toJSON()),/Không có trang đăng nhập lần đầu riêng/);
});


test('Studio branch disclosures preserve the active form draft and translate without remounting it',async t=>{
 const h=await harness(t);await h.editSettings('Draft survives branch navigation');
 const nav=h.renderer.root.findByProps({className:'branched-menu studio-branched-menu'});assert.equal(nav.props['aria-label'],'CMS navigation');
 let group=nav.findByProps({'aria-label':'Administration'});assert.equal(group.props['aria-expanded'],true);const controlled=group.props['aria-controls'];
 await act(async()=>group.props.onClick());
 let body=h.renderer.root.findByProps({id:controlled});assert.equal(body.props.inert,true);assert.equal(body.props['aria-hidden'],true);assert.equal(nav.findByProps({'aria-label':'Site settings'}).props.tabIndex,-1);
 assert.ok(h.renderer.root.findAllByType('textarea').some(n=>n.props.value==='Draft survives branch navigation'));
 await act(async()=>h.site.setLanguage('vi'));assert.equal(h.renderer.root.findByProps({'aria-label':'Quản trị'}).props['aria-expanded'],false);assert.ok(h.renderer.root.findAllByType('textarea').some(n=>n.props.value==='Draft survives branch navigation'));
 await act(async()=>h.renderer.root.findByProps({'aria-label':'Quản trị'}).props.onClick());body=h.renderer.root.findByProps({id:controlled});assert.equal(body.props.inert,false);
 assert.equal(h.backend.calls.filter(c=>c.table==='site_settings').length,0);
});
test('branch navigation offers a read-only staff directory and hides the email-domain banner in Team access',async t=>{
 const h=await harness(t,{role:'editor'});assert.equal(h.renderer.root.findAllByProps({'aria-label':'Team access'}).length,1);assert.equal(h.renderer.root.findAllByProps({'aria-label':'Assistance attribution'}).length,0);
 h.backend.role='manager';await h.emit(authSession('owner'));await act(async()=>{h.renderer.root.findByProps({'aria-label':'Team access'}).props.onClick();await delay(5);});
 assert.equal(h.renderer.root.findAllByProps({className:'team-access-summary'}).length,0);assert.doesNotMatch(JSON.stringify(h.renderer.toJSON()),/Allowed staff email/);assert.ok(h.renderer.root.findByProps({className:'admin-panel team-permissions-guide'}));
});
test('Save changes closes an unchanged profile without changing its password or dismissing the first-login reminder',async t=>{
 const h=await harness(t);h.backend.passwordReminder=true;await act(async()=>h.site.refreshStaffProfile());
 await act(async()=>h.renderer.root.findByProps({'aria-label':'Edit staff profile'}).props.onClick());
 const form=h.renderer.root.findByProps({className:'enquiry-form staff-password-form'});assert.ok(form.findAllByType('button').some(b=>b.children.includes('Save changes')));
 await act(async()=>{await form.props.onSubmit({preventDefault(){}});});assert.equal(h.renderer.root.findAllByType('dialog').length,0);assert.equal(h.backend.passwordCalls.length,0);assert.equal(h.backend.passwordReminder,true);assert.equal(h.backend.rpcCalls.some(c=>c.name==='acknowledge_staff_password_reminder'),false);assert.match(JSON.stringify(h.renderer.toJSON()),/Your profile is up to date/);
});
test('profile password mismatches and Auth failures keep the dialog open without claiming a successful save',async t=>{
 const h=await harness(t);await act(async()=>h.renderer.root.findByProps({'aria-label':'Edit staff profile'}).props.onClick());
 const form=()=>h.renderer.root.findByProps({className:'enquiry-form staff-password-form'});
 await act(async()=>{form().findByProps({name:'password'}).props.onChange({target:{value:'A private new staff password'}});form().findByProps({name:'confirm_password'}).props.onChange({target:{value:'A mismatching password'}});});
 await act(async()=>{await form().props.onSubmit({preventDefault(){}});});assert.equal(h.backend.passwordCalls.length,0);assert.equal(h.renderer.root.findAllByType('dialog').length,1);
 await act(async()=>{form().findByProps({name:'confirm_password'}).props.onChange({target:{value:'A private new staff password'}});});h.backend.passwordError=true;
 await act(async()=>{await form().props.onSubmit({preventDefault(){}});await delay(5);});assert.equal(h.backend.passwordCalls.length,1);assert.equal(h.renderer.root.findAllByType('dialog').length,1);assert.match(JSON.stringify(h.renderer.toJSON()),/Couldn’t confirm the password change/);assert.equal(h.backend.rpcCalls.some(c=>c.name==='acknowledge_staff_password_reminder'),false);
});


test('an unconfirmed photo write cannot be acknowledged by Save changes',async t=>{
 const h=await harness(t);h.backend.upload=deferred();h.backend.writeErrors.set('staff_profiles',{code:'42501',message:'Profile write denied'});
 await act(async()=>h.renderer.root.findByProps({'aria-label':'Edit staff profile'}).props.onClick());
 const upload=h.renderer.root.findAllByType('input').find(n=>n.props.type==='file');
 await act(async()=>{upload.props.onChange({target:{files:[{type:'image/png',size:1024,name:'portrait.png'}],value:'portrait.png'}});await delay(5);});
 await act(async()=>{h.backend.upload.resolve({data:{path:'stored'},error:null});await delay(8);});
 const form=h.renderer.root.findByProps({className:'enquiry-form staff-password-form'});assert.equal(form.findAllByType('button').find(b=>b.children.includes('Save changes')).props.disabled,true);
 await act(async()=>{await form.props.onSubmit({preventDefault(){}});});assert.equal(h.renderer.root.findAllByType('dialog').length,1);assert.equal(h.renderer.root.findAllByProps({className:'staff-profile-toast'}).length,0);assert.match(JSON.stringify(h.renderer.toJSON()),/Couldn’t confirm the photo update/);assert.equal(h.backend.passwordCalls.length,0);
});


test('duplicate staff conflicts survive a background refresh and offer explicit password replacement when restoring access',async t=>{
 const h=await harness(t);await act(async()=>{h.renderer.root.findByProps({'aria-label':'Team access'}).props.onClick();await delay(5);});
 const form=()=>h.renderer.root.findByProps({className:'admin-panel enquiry-form team-invite-form'});
 await act(async()=>{form().findByProps({name:'full_name'}).props.onChange({target:{value:'Returning colleague'}});form().findByProps({name:'email'}).props.onChange({target:{value:'returning@gmail.com'}});form().findByProps({name:'password'}).props.onChange({target:{value:'A new temporary colleague password'}});form().findByProps({name:'confirm_password'}).props.onChange({target:{value:'A new temporary colleague password'}});});
 h.backend.teamPostError={code:'existing_login',error:'A login already exists for this email. Assign or restore staff access instead of creating another login.'};
 await act(async()=>{await form().props.onSubmit({preventDefault(){}});await delay(5);});assert.equal(h.renderer.root.findAllByProps({className:'team-existing-login-callout'}).length,1);
 await act(async()=>{h.browser.dispatchEvent(new Event('gary-staff-directory-changed'));await delay(5);});assert.match(JSON.stringify(h.renderer.toJSON()),/A login already exists/);
 await act(async()=>h.renderer.root.findAllByType('button').find(n=>n.children.includes('Assign and set temporary password')).props.onClick());assert.equal(form().findByProps({name:'password'}).props.value,'A new temporary colleague password');
 h.backend.teamPostError=null;await act(async()=>{await form().props.onSubmit({preventDefault(){}});await delay(5);});
 const posts=h.backend.teamCalls.filter(x=>x.method==='POST');assert.equal(posts.length,2);assert.equal(posts[1].input.mode,'assign');assert.equal(posts[1].input.replace_password,true);assert.equal(posts[1].input.password,'A new temporary colleague password');assert.match(JSON.stringify(h.renderer.toJSON()),/temporary password saved/);
});
test('password visibility controls reveal only the primary field and mask it again after clearing',async t=>{
 const h=await harness(t);await act(async()=>{h.renderer.root.findByProps({'aria-label':'Team access'}).props.onClick();await delay(5);});const form=()=>h.renderer.root.findByProps({className:'admin-panel enquiry-form team-invite-form'});
 await act(async()=>form().findByProps({name:'password'}).props.onChange({target:{value:'A private password to reveal'}}));
 await act(async()=>form().findByProps({'aria-label':'Show password'}).props.onClick({preventDefault(){}}));assert.equal(form().findByProps({name:'password'}).props.type,'text');assert.equal(form().findByProps({name:'confirm_password'}).props.type,'password');assert.equal(form().findByProps({'aria-label':'Hide password'}).props['aria-pressed'],true);
 await act(async()=>h.site.setLanguage('vi'));assert.ok(form().findByProps({'aria-label':'Ẩn mật khẩu'}));assert.equal(form().findByProps({name:'password'}).props.value,'A private password to reveal');
 await act(async()=>form().findByProps({name:'password'}).props.onChange({target:{value:''}}));assert.equal(form().findByProps({name:'password'}).props.type,'password');
});
test('the customer header never borrows a signed-in owner staff photo; About Us excludes agent and testimonial links',async t=>{
 const h=await harness(t,{page:'header',path:'/'});h.backend.profilePaths=new Map([['owner','owner/private-staff-avatar.png']]);await act(async()=>h.site.refreshStaffProfile());
 for(const link of h.renderer.root.findAllByType('a').filter(n=>n.props.className?.includes('customer-login-link')))assert.equal(link.findAllByType('img').length,0);
 const trigger=()=>h.renderer.root.findByProps({'aria-controls':'about-navigation-links'});await act(async()=>trigger().props.onClick());assert.equal(trigger().props['aria-expanded'],true);
 const menu=h.renderer.root.findByProps({id:'about-navigation-links'}),paths=menu.findAllByType('a').map(n=>n.props.href);assert.deepEqual(paths,['/services','/vinhomes','/tips-and-news','/contact','/landlords']);assert.doesNotMatch(JSON.stringify(h.renderer.toJSON()),/Our Agents|Testimonials/);
 await act(async()=>h.site.setLanguage('vi'));assert.match(JSON.stringify(h.renderer.toJSON()),/Dịch vụ của chúng tôi/);
 const event=new Event('keydown');Object.defineProperty(event,'key',{value:'Escape'});await act(async()=>h.browser.dispatchEvent(event));assert.equal(h.renderer.root.findAllByProps({id:'about-navigation-links'}).length,0);
});
test('the landlord page translates and submits through the private introduction API',async t=>{
 const h=await harness(t,{page:'landlords'});const form=h.renderer.root.findByType('form');assert.ok(h.renderer.root.findAllByType('input').some(n=>n.props.name==='owner_name'));
 const fields={owner_name:'Property Owner',email:'owner@example.invalid',phone:'',message:'Apartment in Hanoi available for rental.',address:'12 Example Street, Hanoi',district_slug:'tay-ho',property_type:'Apartment',bedrooms:'2',bathrooms:'1',area_sqm:'75',expected_rent:'800',consent:'on',website:''};
 await act(async()=>{await form.props.onSubmit({preventDefault(){},currentTarget:{fields}});await delay(5);});assert.equal(h.backend.landlordCalls.length,2);assert.equal(h.backend.landlordCalls[1].body.action,'finalize');assert.equal(h.backend.landlordCalls[1].body.details.property_type,'Apartment');assert.equal(h.backend.landlordCalls[1].headers.get('authorization'),'Bearer test-token');
 await act(async()=>h.site.setLanguage('vi'));assert.match(JSON.stringify(h.renderer.toJSON()),/Đã nhận thông tin bất động sản/);
});


test('Tips & News links original sourced articles and undated rental guides in both languages',async t=>{
 const h=await harness(t,{page:'tips'});const paths=h.renderer.root.findAllByType('a').map(n=>n.props.href).filter(x=>x?.startsWith('/tips-and-news/'));assert.equal(new Set(paths).size,6);assert.ok(paths.includes('/tips-and-news/viewing-checklist'));
 await act(async()=>h.site.setLanguage('vi'));assert.match(JSON.stringify(h.renderer.toJSON()),/CẨM NANG THUÊ NHÀ/);assert.equal(h.renderer.root.findAllByType('time').length,3);assert.equal(h.renderer.root.findAllByType('time')[0].props.dateTime,'2026-10-26');
});

test('landlord uploads keep the draft and completed files across language changes and manual retry',async t=>{
 const h=await harness(t,{page:'landlords'}),fields={owner_name:'Property Owner',email:'owner@example.invalid',phone:'',address:'12 Example Street, Hanoi',district_slug:'tay-ho',property_type:'Apartment',bedrooms:'2',bathrooms:'1',area_sqm:'75',expected_rent:'800',message:'Current property details for the review.',consent:'on',website:''};
 const fileInput=()=>h.renderer.root.findByProps({type:'file'}),submit=()=>h.renderer.root.findByType('form').props.onSubmit({preventDefault(){},currentTarget:{fields}});
 const files=[new File([new Uint8Array(128)],'first.png',{type:'image/png'}),new File([new Uint8Array(128)],'second.png',{type:'image/png'})];
 await act(async()=>fileInput().props.onChange({target:{files,value:'selected'}}));h.backend.privateUploadError='second.png';
 await act(async()=>{await submit();await delay(5);});assert.equal(h.backend.privateUploads.length,2);assert.equal(h.backend.landlordCalls.length,1);assert.ok(h.renderer.root.findAllByProps({role:'alert'}).length);
 await act(async()=>h.site.setLanguage('vi'));assert.equal(h.renderer.root.findAllByProps({className:'landlord-file-list'})[0].findAllByType('li').length,2);assert.equal(h.backend.privateUploads.length,2);
 h.backend.privateUploadError=null;await act(async()=>{await submit();await delay(5);});assert.equal(h.backend.privateUploads.length,3);assert.equal(h.backend.privateUploads[2].name,'second.png');assert.equal(h.backend.landlordCalls.filter(call=>call.body.action==='prepare').length,1);assert.equal(h.backend.landlordCalls.filter(call=>call.body.action==='finalize').length,1);assert.match(JSON.stringify(h.renderer.toJSON()),/Đã nhận thông tin bất động sản/);
});
test('Services uses a cover with different image bytes from the home hero',async t=>{
 const h=await harness(t,{page:'services'});const image=h.renderer.root.findByProps({className:'about-section-hero'}).findByType('img');assert.notEqual(image.props.src,fixture.settings.hero_image);assert.notDeepEqual(fs.readFileSync(path.join(base,'public',image.props.src)),fs.readFileSync(path.join(base,'public',fixture.settings.hero_image)));
});

test('the private property queue preserves a review during translation and only reloads when requested',async t=>{
 const h=await harness(t),id='record-1';h.backend.rows.landlord_submissions=[{id,address:'12 Example Street',owner_name:'Private Owner',email:'private@example.invalid',phone:'',district_slug:'tay-ho',property_type:'Apartment',bedrooms:2,bathrooms:1,area_sqm:75,expected_rent:800,currency:'USD',message:'Private property introduction.',status:'new',assigned_to:null,staff_notes:'Existing note',listing_id:null,created_at:'2026-10-26T00:00:00Z'}];
 await act(async()=>{h.renderer.root.findByProps({'aria-label':'Introduced properties'}).props.onClick();await delay(5);});
 const list=()=>h.renderer.root.findByProps({className:'landlord-records'});await act(async()=>{list().findByType('button').props.onClick();await delay(5);});const notes=h.renderer.root.findByProps({name:'staff_notes'});
 const count=()=>h.backend.privateReads.filter(table=>table==='landlord_submissions').length;const before=count();assert.equal(before,1);
 await act(async()=>{h.site.setLanguage('vi');await delay(25);});assert.equal(count(),before);assert.equal(h.renderer.root.findByProps({name:'staff_notes'}),notes);assert.match(JSON.stringify(h.renderer.toJSON()),/Bất động sản được giới thiệu/);
 const form=h.renderer.root.findByProps({className:'editor-form landlord-review'});await act(async()=>{await form.props.onSubmit({preventDefault(){},currentTarget:{fields:{decision:'reviewing',staff_notes:'A new internal note',assignee:''}}});await delay(5);});const saved=h.backend.rpcCalls.filter(call=>call.name==='review_landlord_submission');assert.equal(saved.length,1);assert.equal(saved[0].args.notes,'A new internal note');assert.equal(count(),before);assert.equal(saved[0].args.assignee,null);
 await h.emit(null);assert.equal(h.renderer.root.findAllByProps({className:'landlord-review'}).length,0);
});

test('admin directory shows peer admins with no management controls and filters out owner accounts',async t=>{
 const h=await harness(t,{role:'admin'});h.backend.teamRows=['owner','admin','manager','editor'].map(role=>({user_id:'directory-'+role,display_name:'Directory '+role,email:role+'@gmail.com',role,active:true,confirmed:true}));
 await act(async()=>{h.renderer.root.findByProps({'aria-label':'Team access'}).props.onClick();await delay(5);});const rows=h.renderer.root.findAllByProps({className:'team-member'});assert.equal(rows.length,3);assert.ok(!rows.some(row=>row.findByType('strong').children.join('')==='Directory owner'));
 const peer=rows.find(row=>row.findByType('strong').children.join('')==='Directory admin');assert.ok(peer);assert.equal(peer.findAllByType('button').length,0);assert.match(peer.findByProps({className:'team-protected'}).children.filter(child=>typeof child==='string').join(''),/View only/);
 const manager=rows.find(row=>row.findByType('strong').children.join('')==='Directory manager');assert.ok(manager.findAllByType('button').length>0);assert.equal(h.backend.teamCalls.filter(call=>call.method!=='GET').length,0);
 await act(async()=>h.site.setLanguage('vi'));assert.match(JSON.stringify(h.renderer.toJSON()),/Chỉ xem/);
});
test('staff can see a read-only peer directory without creation, access or password controls',async t=>{
 const h=await harness(t,{role:'editor'});h.backend.teamRows=['owner','admin','manager','editor','editor'].map((role,index)=>({user_id:'directory-'+index,display_name:'Directory '+role+' '+index,email:'directory'+index+'@gmail.com',role,active:true,confirmed:true}));
 await act(async()=>{h.renderer.root.findByProps({'aria-label':'Team access'}).props.onClick();await delay(5);});const rows=h.renderer.root.findAllByProps({className:'team-member'});assert.equal(rows.length,2);assert.ok(rows.every(row=>row.findByType('strong').children.join('').startsWith('Directory editor')));assert.equal(h.renderer.root.findAllByProps({className:'admin-panel enquiry-form team-invite-form'}).length,0);assert.ok(rows.every(row=>row.findAllByType('button').length===0));
 const count=h.backend.teamCalls.length;await act(async()=>{h.site.setLanguage('vi');await delay(10);});assert.equal(h.backend.teamCalls.length,count);assert.match(JSON.stringify(h.renderer.toJSON()),/Bạn có thể xem các nhân viên khác/);
});

test('guest favourites automatically merge into the logged-in account without duplicates or replacing existing saves',async t=>{
 const ids=fixture.properties.slice(0,3).map(p=>p.id),h=await harness(t,{guest:true,customer:true,publicOnly:true,storage:{'gary-saved':JSON.stringify([ids[0],ids[1],ids[0]])}});h.backend.rows.saved_homes=[{user_id:'customer',property_id:ids[2]}];
 await h.emit(authSession('customer'));await act(async()=>{await delay(35);});assert.deepEqual(new Set(h.site.saved),new Set(ids));const writes=h.backend.calls.filter(call=>call.table==='saved_homes'&&call.method==='upsert');assert.equal(writes.length,1);assert.ok(writes[0].payload.every(row=>row.user_id==='customer'));assert.equal(h.stored.get('gary-saved'),undefined);
 await h.emit(authSession('customer'));assert.equal(h.backend.calls.filter(call=>call.table==='saved_homes'&&call.method==='upsert').length,1);assert.deepEqual(new Set(h.site.saved),new Set(ids));
});
test('failed guest-favourite sync retains the cache and supports a manual retry without automatic write loops',async t=>{
 const id=fixture.properties[0].id,h=await harness(t,{guest:true,customer:true,publicOnly:true,storage:{'gary-saved':JSON.stringify([id])}});h.backend.writeErrors.set('saved_homes',new Error('Offline'));await h.emit(authSession('customer'));await act(async()=>{await delay(25);});assert.ok(h.stored.get('gary-saved')?.includes(id));assert.ok(h.site.savedError);const before=h.backend.calls.filter(call=>call.table==='saved_homes'&&call.method==='upsert').length;await act(async()=>h.site.setLanguage('vi'));assert.equal(h.backend.calls.filter(call=>call.table==='saved_homes'&&call.method==='upsert').length,before);
 h.backend.writeErrors.delete('saved_homes');await act(async()=>{await h.site.importSaved();await delay(10);});assert.ok(h.site.saved.includes(id));assert.equal(h.stored.get('gary-saved'),undefined);
});
test('a pending guest-favourite transfer never crosses into another account',async t=>{
 const id=fixture.properties[0].id,h=await harness(t,{guest:true,customer:true,publicOnly:true,storage:{'gary-saved':JSON.stringify([id])}}),pending=deferred();h.backend.writes.set('saved_homes',pending);await h.emit(authSession('customer'));await h.emit(authSession('other-customer'));assert.ok(!h.site.saved.includes(id));assert.equal(h.backend.calls.filter(call=>call.table==='saved_homes'&&call.method==='upsert').length,1);
 await act(async()=>{pending.resolve({data:[{property_id:id}],error:null});await delay(10);});assert.equal(h.site.user.id,'other-customer');assert.ok(!h.site.saved.includes(id));assert.ok(h.stored.get('gary-saved')?.includes(id));
});

test('About Us opens on desktop hover, closes outside its container and stays click-operated on touch',async t=>{
 const h=await harness(t,{guest:true,page:'header',path:'/'}),about=()=>h.renderer.root.findByProps({className:'about-navigation'}),trigger=()=>h.renderer.root.findByProps({'aria-controls':'about-navigation-links'});
 await act(async()=>about().props.onPointerEnter({pointerType:'mouse'}));assert.equal(trigger().props['aria-expanded'],true);await act(async()=>about().props.onPointerLeave({pointerType:'mouse'}));assert.equal(trigger().props['aria-expanded'],false);await act(async()=>about().props.onPointerEnter({pointerType:'touch'}));assert.equal(trigger().props['aria-expanded'],false);await act(async()=>trigger().props.onClick());assert.equal(trigger().props['aria-expanded'],true);await act(async()=>about().props.onBlur({currentTarget:{contains:()=>false},relatedTarget:null}));assert.equal(trigger().props['aria-expanded'],false);
 const nav=h.renderer.root.findByProps({id:'site-navigation'}),items=nav.children.filter(child=>typeof child!=='string');assert.equal(items[0].props.className,'district-navigation');assert.equal(items[1].props.className,'about-navigation');assert.ok(items[2].props.className.includes('header-feedback'));assert.equal(items[2].props.href,'/feedback');
});

test('restaurant and office consultancy links translate and open the real contact flow',async t=>{
 const h=await harness(t,{page:'services'}),links=()=>h.renderer.root.findAllByType('a').filter(n=>n.props.href?.startsWith('/contact?service='));assert.deepEqual(links().map(n=>n.props.href),['/contact?service=restaurant','/contact?service=office']);assert.match(JSON.stringify(h.renderer.toJSON()),/Opening a restaurant/);await act(async()=>h.site.setLanguage('vi'));assert.match(JSON.stringify(h.renderer.toJSON()),/Mở văn phòng/);assert.equal(links().length,2);
});

test('commercial enquiries preserve their draft through translation and send the selected service to the inbox',async t=>{
 const h=await harness(t,{guest:true,page:'contact',url:'https://gary.example/contact?service=restaurant',path:'/contact'}),form=h.renderer.root.findByType('form'),message=form.findByProps({name:'message'});assert.match(JSON.stringify(h.renderer.toJSON()),/Restaurant opening consultancy/);
 await act(async()=>h.site.setLanguage('vi'));assert.equal(h.renderer.root.findByType('form'),form);assert.equal(form.findByProps({name:'message'}),message);assert.match(JSON.stringify(h.renderer.toJSON()),/Tư vấn mở nhà hàng/);
 const fields={name:'A customer',email:'customer@example.invalid',phone:'',message:'A small restaurant space in Hanoi.',preferred_date:'',consent:'on',website:''};await act(async()=>{await form.props.onSubmit({preventDefault(){},currentTarget:{fields}});await delay(5);});assert.equal(h.backend.enquiryPosts.length,1);assert.equal(h.backend.enquiryPosts[0].data.message,'Tư vấn mở nhà hàng\n\nA small restaurant space in Hanoi.');assert.equal(h.backend.enquiryPosts[0].data.kind,'general');assert.equal(h.backend.enquiryPosts[0].data.property_id,null);
});

test('Vinhomes enquiries carry the exact apartment reference and still require a customer message',async t=>{
 const h=await harness(t,{customer:true,page:'contact',url:'https://gary.example/contact?project=smart-city',path:'/contact'}),form=h.renderer.root.findByType('form');assert.match(JSON.stringify(h.renderer.toJSON()),/Vinhomes Smart City · S403 · GH202/);const fields={name:'A customer',email:'customer@example.invalid',message:'',consent:'on',website:''};await act(async()=>{await form.props.onSubmit({preventDefault(){},currentTarget:{fields}});await delay(5);});assert.equal(h.backend.enquiryPosts?.length||0,0);
 fields.message='Please arrange a viewing for this home.';await act(async()=>{await form.props.onSubmit({preventDefault(){},currentTarget:{fields}});await delay(5);});assert.equal(h.backend.enquiryPosts.length,1);assert.equal(h.backend.enquiryPosts[0].data.message,'Vinhomes Smart City · S403 · GH202\n\nPlease arrange a viewing for this home.');assert.equal(h.backend.enquiryPosts[0].headers.get('authorization'),'Bearer test-token');
});


test('Studio groups listings and galleries under rentals and separates assistance and editorial work',async t=>{
 const h=await harness(t),nav=h.renderer.root.findByProps({className:'branched-menu studio-branched-menu'});
 const children=label=>nav.findByProps({'aria-label':label}).parent.findAllByType('button').map(n=>n.props['data-id']).filter(Boolean);
 assert.deepEqual(children('Rentals & content'),['properties','landlords','neighbourhoods','rental-content']);assert.deepEqual(children('Customer care'),['enquiries','customers','feedback']);assert.deepEqual(children('Assistance & publishing'),['assistance','news','tips']);
 assert.equal(nav.findAllByProps({'data-id':'media'}).length,0);
 await act(async()=>nav.findByProps({'aria-label':'Listings'}).props.onClick());const workspace=h.renderer.root.findByProps({'aria-label':'Listing workspace'});await act(async()=>workspace.findAllByType('button')[1].props.onClick());assert.ok(h.renderer.root.findByProps({className:'admin-media-grid'}));assert.equal(nav.findByProps({'aria-label':'Listings'}).props['aria-current'],'page');
 await act(async()=>h.site.setLanguage('vi'));assert.equal(h.renderer.root.findAllByProps({'aria-label':'Hỗ trợ & biên tập'}).length,1);assert.equal(h.renderer.root.findAllByProps({'aria-label':'Thành viên & thư viện'}).length,1);
});

test('gallery sections separate feedback screenshots and retain a feedback draft across tabs and translation',async t=>{
 const h=await harness(t);await act(async()=>h.site.setContent(previous=>({...previous,activities:JSON.parse(fs.readFileSync(path.join(base,'data/activities.json'),'utf8'))})));
 await act(async()=>h.renderer.root.findByProps({'aria-label':'People & galleries'}).props.onClick());const gallery=()=>h.renderer.root.findByProps({className:'rental-cms'}),tabs=()=>gallery().findByProps({'aria-label':h.site.language==='vi'?'Mục nội dung':'Content section'}).findAllByType('button');assert.equal(tabs().length,3);assert.equal(gallery().findAllByProps({className:'rental-cms-row'}).length,17);
 await act(async()=>tabs()[2].props.onClick());assert.equal(gallery().findAllByProps({className:'rental-cms-row'}).length,1);await act(async()=>gallery().findByProps({className:'rental-cms-row'}).props.onClick());const caption=gallery().findAllByType('textarea')[0];await act(async()=>caption.props.onChange({target:{value:'Approved screenshot caption draft'}}));await act(async()=>tabs()[1].props.onClick());await act(async()=>tabs()[2].props.onClick());assert.equal(gallery().findAllByType('textarea')[0].props.value,'Approved screenshot caption draft');await act(async()=>h.site.setLanguage('vi'));assert.equal(gallery().findAllByType('textarea')[0].props.value,'Approved screenshot caption draft');
 await act(async()=>{gallery().findByType('form').props.onSubmit({preventDefault(){}});await delay(10);});assert.equal(h.backend.calls.filter(c=>c.table==='site_activities').at(-1).payload.category,'feedback');
});

test('news drafts survive language and session refresh, save privately and clear from public content after sign-out',async t=>{
 const h=await harness(t);await act(async()=>h.renderer.root.findByProps({'aria-label':'News articles'}).props.onClick());await act(async()=>h.renderer.root.findAllByType('button').find(b=>b.children.includes('New article')).props.onClick());const form=h.renderer.root.findByType('form');await act(async()=>{form.findByProps({name:'article_slug'}).props.onChange({target:{value:'private-editorial-ui-test'}});form.findByProps({name:'article_title_en'}).props.onChange({target:{value:'Private unfinished news draft'}});});
 await act(async()=>h.site.setLanguage('vi'));assert.equal(h.renderer.root.findByType('form'),form);assert.equal(form.findByProps({name:'article_title_en'}).props.value,'Private unfinished news draft');await act(async()=>{await h.site.refresh();await delay(5);});assert.equal(form.findByProps({name:'article_title_en'}).props.value,'Private unfinished news draft');
 await act(async()=>{form.props.onSubmit({preventDefault(){}});await delay(10);});const saved=h.backend.calls.filter(c=>c.table==='editorial_articles').at(-1);assert.equal(saved.method,'insert');assert.equal(saved.payload.status,'draft');assert.equal(saved.payload.kind,'news');assert.ok(h.site.content.editorial.some(row=>row.slug==='private-editorial-ui-test'));await h.emit(null);assert.ok(h.site.content.editorial.every(row=>row.status==='published'));assert.ok(!h.site.content.editorial.some(row=>row.slug==='private-editorial-ui-test'));
});

test('rental-tip edits made during a slow save remain a draft with the latest concurrency timestamp',async t=>{
 const h=await harness(t,{role:'manager'});await act(async()=>h.renderer.root.findByProps({'aria-label':'Rental tips'}).props.onClick());await act(async()=>h.renderer.root.findByProps({className:'admin-panel editorial-list'}).findAllByType('button')[0].props.onClick());const form=()=>h.renderer.root.findByType('form');assert.ok(!form().findAllByType('button').some(b=>b.children.includes('Delete article')));const current=h.site.content.editorial.find(row=>row.slug===form().findByProps({name:'article_slug'}).props.value),pending=deferred(),stamp='2026-10-26T18:00:00.123456Z';h.backend.writes.set('editorial_articles',pending);
 await act(async()=>{form().props.onSubmit({preventDefault(){}});await delay(5);});await act(async()=>form().findByProps({name:'article_title_en'}).props.onChange({target:{value:'A newer unsaved rental tip title'}}));await act(async()=>{pending.resolve({data:{...current,updated_at:stamp},error:null});await delay(10);});assert.equal(form().findByProps({name:'article_title_en'}).props.value,'A newer unsaved rental tip title');h.backend.writes.delete('editorial_articles');await act(async()=>{form().props.onSubmit({preventDefault(){}});await delay(10);});const calls=h.backend.calls.filter(c=>c.table==='editorial_articles');assert.equal(calls.length,2);assert.equal(calls[1].filters.updated_at,stamp);assert.equal(calls[1].payload.title_en,'A newer unsaved rental tip title');
});

test('editorial publication errors translate in place and preserve the incomplete draft',async t=>{
 const h=await harness(t);await act(async()=>h.renderer.root.findByProps({'aria-label':'News articles'}).props.onClick());await act(async()=>h.renderer.root.findByProps({className:'admin-panel editorial-list'}).findAllByType('button')[0].props.onClick());const form=h.renderer.root.findByType('form');await act(async()=>form.findByProps({name:'article_title_vi'}).props.onChange({target:{value:''}}));await act(async()=>{form.props.onSubmit({preventDefault(){}});await delay(5);});assert.match(JSON.stringify(h.renderer.root.findByProps({role:'alert'}).children),/Before publishing/);assert.equal(h.backend.calls.filter(c=>c.table==='editorial_articles').length,0);await act(async()=>h.site.setLanguage('vi'));assert.equal(h.renderer.root.findByType('form'),form);assert.equal(form.findByProps({name:'article_title_vi'}).props.value,'');assert.match(JSON.stringify(h.renderer.root.findByProps({role:'alert'}).children),/Trước khi đăng/);
});


test('fresh editorial page props update a persistent public snapshot without discarding private staff drafts',async t=>{
 const original=fixture.editorial[0],newRow={...original,id:'fresh-public-story',slug:'fresh-public-story',title_en:'Freshly published story'},serverRows=[...fixture.editorial,newRow],draft={...original,id:'private-draft',slug:'private-draft',status:'draft',title_en:'Private local article'};
 const h=await harness(t,{page:'tips',editorialPageRows:serverRows,deferPage:true});await act(async()=>h.site.setContent(previous=>({...previous,editorial:[...fixture.editorial,draft]})));await h.mountPage();assert.ok(h.site.content.editorial.some(a=>a.id===newRow.id));assert.ok(h.site.content.editorial.some(a=>a.id===draft.id));assert.ok(h.renderer.root.findAllByType('a').some(a=>a.props.href==='/tips-and-news/fresh-public-story'));const before=h.backend.privateReads.filter(table=>table==='editorial_articles').length;await act(async()=>h.site.setLanguage('vi'));assert.equal(h.backend.privateReads.filter(table=>table==='editorial_articles').length,before);await h.emit(null);assert.ok(h.site.content.editorial.some(a=>a.id===newRow.id));assert.ok(!h.site.content.editorial.some(a=>a.id===draft.id));
});
