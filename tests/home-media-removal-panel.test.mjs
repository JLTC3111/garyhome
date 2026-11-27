import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import postcss from 'postcss';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from 'typescript';
import * as trash from '../lib/home-media-trash.ts';
import * as storageMedia from '../lib/home-media-request.ts';
import * as requests from '../lib/requests.ts';
import { createMediaCleanup } from '../supabase/functions/media-orphan-cleanup/worker.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const names = ['media-removal-progress', 'media-selection', 'listing-deletion-queue', 'storage-orphan-review'];
const sources = [...names.map(name => [name,`components/${name}.tsx`]), ['storage-media-route','app/api/admin/storage-media/route.ts']];
const components = new Map(sources.map(([name,path]) => [name, new vm.Script('(function(exports,require,module){' +
  ts.transpileModule(read(path), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText + '\n})')]));
function load(name, mocks, context) {
  const module = { exports: {} };
  components.get(name).runInContext(context)(module.exports, id => mocks[id] ?? require(id), module);
  return module.exports;
}

const dropdown = {
  DropdownMenu:({children})=>children,
  DropdownMenuTrigger:({children})=>children,
  DropdownMenuContent:({children})=>children,
  DropdownMenuItem:({children,...props})=>React.createElement('div',{...props,role:'menuitem'},children),
};
const css = name => postcss.parse(read(`app/${name}.css`));
const globals = css('globals'), publicTheme = css('public-theme'), studio = css('studio-theme'), panelCss = css('listing-management');
const styles = (tree, selector) => Object.fromEntries(tree.nodes.find(node => node.selector === selector).nodes
  .filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
function palette(theme) {
  const tokens = {...styles(globals, ':root'), ...styles(publicTheme, ':root'), ...styles(studio, 'html:has(.admin-shell)')};
  if (theme === 'dark') Object.assign(tokens, styles(studio,
    'html[data-home-theme="dark"]:not([data-home-public="true"]):has(.admin-shell, .session-gate, .page-loading)'));
  const resolve = value => /^var\((--[\w-]+)\)$/.test(value) ? resolve(tokens[value.slice(4, -1)]) : value;
  return resolve;
}
function luminance(color) {
  if (color.length === 4) color = '#' + [...color.slice(1)].map(channel => channel.repeat(2)).join('');
  const rgb = color.slice(1).match(/../g).map(hex => parseInt(hex, 16) / 255);
  return rgb.map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [.2126, .7152, .0722][index], 0);
}

for (const theme of ['light', 'dark']) {
  test(`${theme} panel text, enabled buttons, focus and progress contrast meet WCAG AA`, t => {
    const resolve = palette(theme);
    const panel = styles(panelCss, '.storage-removal-progress');
    const label = styles(panelCss, '.storage-removal-progress__metrics dt');
    const fill = styles(panelCss, '.storage-removal-progress__fill');
    const track = styles(panelCss, '.storage-removal-progress__track');
    function verify(name, a, b, minimum) {
      const colors = [a,b].map(resolve);
      assert.ok(colors.every(color => /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)), `Resolved colors for ${name}`);
      const values = colors.map(luminance);
      const ratio = (Math.max(...values) + .05) / (Math.min(...values) + .05);
      assert.ok(ratio >= minimum, `${name}: ${ratio.toFixed(2)}:1 < ${minimum}:1`);
      t.diagnostic(`${name} ${ratio.toFixed(2)}:1`);
    }
    verify('Text', panel.color, panel.background, 4.5);
    verify('Secondary text', label.color, panel.background, 4.5);
    verify('Diagnostic labels', styles(panelCss, '.storage-removal-progress__diagnostic dt').color, panel.background, 4.5);
    const search = styles(panelCss, '.storage-media-search');
    verify('Search icon and placeholder', search.color, search.background, 4.5);
    verify('Search focus border', 'var(--studio-focus)', search.background, 3);
    const outlineText = styles(globals, '.button-outline').color;
    verify('Outline button text', outlineText, panel.background, 4.5);
    verify('Outline button hover', outlineText, 'var(--studio-quiet-hover)', 4.5);
    verify('Outline button active', outlineText, 'var(--studio-quiet-active)', 4.5);
    verify('Outline button border', 'var(--studio-control-border)', panel.background, 3);
    verify('Focus outline', 'var(--studio-focus)', panel.background, 3);
    for (const state of ['', '-hover', '-active']) {
      verify(`Resume button${state}`, 'var(--studio-on-action)', `var(--studio-action${state})`, 4.5);
    }
    verify('Progress fill and track', fill.background, track.background, 3);
  });

  test(`${theme} File Trash preserves the paused run through individual deletion, restore, resume and cancel`, async () => {
    const owner = 'owner';
    const prefix = `gary-home:media:${owner}`;
    const key = `${prefix}:trash-run`;
    const expires_at = new Date(Date.now() + 3_600_000).toISOString();
    const files = ['one', 'two', 'three', 'four', 'five'].map(id => ({
      id, name: `photos/${id}.webp`, bucket: 'property-media', expires_at, bytes: 120,
    }));
    const initial = trash.makeTrashRun(files);
    initial.state = 'paused';
    initial.issue = 'media_busy';
    initial.entries[1].reason = 'media_busy';
    initial.entries[1].retryCount = 1;
    initial.entries[0].outcome = 'removed';
    initial.timing = {elapsedMs:5000, measuredFiles:1};
    const store = new Map([[key, JSON.stringify(initial)], [`${prefix}:trash-selection`, JSON.stringify(files.slice(1))]]);
    let lock = false, finishDeletion;
    const live = new Map(files.slice(1).map(item => [item.id,item]));
    const calls = [];
    const context = vm.createContext({
      Date, Error, AbortController, performance, setTimeout, clearTimeout, setInterval, clearInterval,
      localStorage: {getItem:k => store.get(k) ?? null, setItem:(k,v) => store.set(k,v)},
      window: {addEventListener(){}, removeEventListener(){}, confirm:()=>true},
      navigator: {locks: {async request(_, __, useLock) {
        if (lock) return useLock(null);
        lock = true;
        try { return await useLock({}); } finally { lock = false; }
      }}},
      async fetch(_, {body}) {
        const args = JSON.parse(body);
        calls.push(args);
        switch (args.action) {
          case 'worker_status': return Response.json({status:'ok', cronConfigured:true});
          case 'overview': return Response.json({panelVersion:2, objects:live.size, bytes:live.size*120,
            candidates:0, candidateBytes:0, abandoned:0, activeUploads:0, broken:0, enabled:true, crossAppProtection:true,
            earlyEligible:live.size, overdue:0, trashed:live.size, checkedAt:new Date().toISOString()});
          case 'trash_manifest': return Response.json({items:[...live.values()]});
          case 'trash_receipt': return Response.json(live.has(args.id)?{status:'eligible',bytes:120}:{status:'removed',bytes:120});
          case 'trash_page': return Response.json({items:[...live.values()].map(item=>({...item,state:'trashed',restore_mode:'file'})),
            hasMore:false, available:true});
          case 'retention_page': return Response.json({items:[
            {name:'fixtures/recovery.webp',bucket:'property-media',listing_code:'GH-645',object_id:'photo',reason:'recovery_hold',bytes:120},
            {name:'fixtures/tour.mp4',bucket:'listing-videos',object_id:'tour',reason:'waiting',eligible_at:expires_at,bytes:200},
            {name:'fixtures/unused.webp',bucket:'property-media',object_id:'unused',reason:'eligible',eligible_at:'2026-01-01T00:00:00Z',scheduled_eligible:true,bytes:300},
          ],hasMore:false,available:true,automatic:true});
          case 'removed_page': return Response.json({items:[], hasMore:false, available:true});
          case 'restore':
            live.delete(args.id);
            return Response.json({id:args.id,restored:true,listingId:null});
          case 'purge': return new Promise(resolve => {
            const recorded=JSON.parse(store.get(key));
            const sent=recorded.individualRequest??recorded.entries.find(row=>row.id===args.id);
            assert.equal(sent.id,args.id);
            assert.equal(sent.outcome,'sent');
            finishDeletion = () => { live.delete(args.id); resolve(Response.json({status:'ok',removed:1})); };
          });
          default: throw new Error(`Unexpected media action ${args.action}`);
        }
      },
    });
    const t = en => en;
    const site = { t, language:'en', user:{id:owner}, notice:()=>{},
      editorTask:(operation)=>operation({auth:{getSession:async()=>({data:{session:{access_token:'test'}}})}},new AbortController().signal) };
    const mocks = {'@/lib/home-media-trash':trash, './site-context':{useSite:()=>site},
      './ui/dropdown-menu':dropdown,
      '@/lib/property-photo-files':{PROPERTY_IMAGE_ORIGIN:'https://example.test'}, './storage-orphan-review':{StorageOrphanReview:()=>null}};
    mocks['./media-selection'] = load('media-selection', mocks, context);
    mocks['./media-removal-progress'] = load('media-removal-progress', mocks, context);
    const {StorageMediaManagement} = load('listing-deletion-queue', mocks, context);
    const page = visible => React.createElement('div', {'data-home-theme':theme},
      React.createElement(StorageMediaManagement, {visible,latest:null,onListingRestored:()=>{}}));
    let view;
    const saved = () => trash.readTrashRun(store.get(key));
    const button = label => view.root.findAllByType('button').find(node=>node.children.join('')===label);
    const state = () => view.root.findByProps({className:'storage-removal-progress'}).props['data-state'];
    const click = async label => act(async()=>button(label).props.onClick());
    const filter = async value => act(async()=>view.root.findByProps({type:'search'}).props.onChange({target:{value}}));
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async()=>{view = TestRenderer.create(page(true));});
      await act(async()=>{view.root.findByType('details').props.onToggle({currentTarget:{open:true}});});
      await click('Retention preview');
      const retentionLabels=view.root.findAllByType('small').map(node=>node.children.join(''));
      assert.ok(retentionLabels.some(label=>label.includes('Protected for GH-645 recovery.')));
      assert.ok(retentionLabels.some(label=>label.includes('remaining')&&label.includes('Eligible from')));
      assert.ok(retentionLabels.includes('Eligible for scheduled cleanup'));
      assert.equal(button('Retention preview').props['aria-pressed'],true);
      await click('File Trash');
      assert.equal(state(),'paused');
      assert.equal(view.root.findByProps({className:'storage-removal-progress'}).findByType('h3').children.join(''),'Removal paused by the system');
      const diagnostic=view.root.findByProps({className:'storage-removal-progress__diagnostic'});
      assert.equal(diagnostic.findByType('code').children.join(''),'media_busy');
      assert.deepEqual(diagnostic.findAllByType('dd').filter(node=>typeof node.children[0]==='string').map(node=>node.children.join('')),['two.webp','1']);
      assert.equal(button('Resume').props.disabled,false);
      assert.equal(button('Permanently delete now').props.disabled,false);
      assert.equal(button('Keep file').props.disabled,false);
      assert.deepEqual(view.root.findAllByProps({role:'menuitem'}).map(item=>item.children.join('')),
        ['Select all eligible files','Select current page','Clear selection']);
      const master=()=>view.root.findByProps({'aria-label':'Select eligible files on this page'});
      const checkThree=checked=>view.root.findByProps({'aria-label':'Select three.webp'}).props.onChange({target:{checked}});
      await act(async()=>checkThree(false));
      assert.equal(master().props['aria-checked'],'mixed');
      await act(async()=>checkThree(true));
      await filter('three');
      assert.equal(master().props.checked,true);
      await act(async()=>master().props.onChange());
      assert.equal(master().props.checked,false);
      assert.equal(JSON.parse(store.get(`${prefix}:trash-selection`)).length,3);
      await act(async()=>master().props.onChange());
      assert.equal(master().props.checked,true);
      await click('Permanently delete now');
      await act(async()=>finishDeletion());
      assert.equal(state(),'paused');
      assert.equal(saved().entries[2].outcome,'removed');
      assert.equal(saved().timing.elapsedMs,5000);
      assert.equal(trash.trashRunTotals(saved()).reclaimedBytes,240);
      await filter('four');
      await click('Keep file');
      assert.equal(saved().entries[3].reason,'restored');
      assert.equal(saved().entries[3].outcome,'skipped');
      await act(async()=>view.root.findByProps({'aria-label':'Clear search'}).props.onClick());
      assert.equal(view.root.findByProps({type:'search'}).props.value,'');
      await click('Resume');
      assert.equal(state(),'running');
      assert.equal(view.root.findByProps({className:'storage-media-controls'}).props.hidden,true);
      await act(async()=>{view.update(page(false));});
      await act(async()=>{view.update(page(true));});
      assert.equal(state(),'running');
      assert.deepEqual(calls.filter(call=>call.action==='purge').map(call=>call.id),['three','two']);
      await click('Stop after the current file');
      assert.equal(state(),'stopping');
      await act(async()=>finishDeletion());
      assert.equal(state(),'paused');
      assert.ok(saved().timing.elapsedMs>=5000);
      assert.equal(trash.trashRunTotals(saved()).removed,3);
      const requestsBeforeCancel=calls.length;
      await click('Cancel remaining');
      assert.equal(calls.length,requestsBeforeCancel,'cancelling without a sent item needs no inventory request');
      assert.equal(state(),'cancelled');
      assert.equal(view.root.findByProps({className:'storage-media-controls'}).props.hidden,false);
      assert.equal(button('Permanently delete now').props.disabled,false);
      assert.equal(button('Permanently delete selected').props.disabled,true);
      assert.equal(button('Resume'),undefined);
      assert.equal(trash.trashRunTotals(saved()).cancelled,1);
      await act(async()=>view.root.findByProps({'aria-label':'Select five.webp'}).props.onChange({target:{checked:true}}));
      assert.equal(button('Permanently delete selected').props.disabled,false);
      await click('Permanently delete now');
      await act(async()=>finishDeletion());
      assert.equal(state(),'completed');
      assert.deepEqual(calls.filter(call=>call.action==='trash_receipt').map(call=>call.id),['three','five']);
      assert.deepEqual(calls.filter(call=>call.action==='purge').map(call=>call.id),['three','two','five']);
      assert.ok(calls.some(call=>call.action==='removed_page'));
    } finally {
      if (view) await act(async()=>view.unmount());
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
  });
}

test('selected deletion confirms the live manifest and dispatches each eligible file through the API and worker while paused', async () => {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const owner=id(100), origin='https://storage-fixture.example';
  const expires_at=new Date(Date.now()+3_600_000).toISOString();
  const file=(n,bytes,bucket='property-media')=>({id:id(n),bucket,name:`fixtures/${n}.${bucket==='listing-videos'?'mp4':'webp'}`,expires_at,bytes});
  const [prior,first,second,protectedFile,remaining,outside,stale]=[
    file(1,100_000),file(2,200_000),file(3,300_000),file(4,400_000),file(5,500_000),file(6,600_000,'listing-videos'),file(7,700_000),
  ];
  const prefix=`gary-home:media:${owner}`,key=`${prefix}:trash-run`,selectionKey=`${prefix}:trash-selection`;
  const initial=trash.makeTrashRun([prior,first,second,protectedFile,remaining]);
  initial.state='paused';
  initial.entries[0].outcome='removed';
  initial.timing={elapsedMs:8000,measuredFiles:1};
  const selected=[first,second,protectedFile,outside,stale];
  const store=new Map([[key,JSON.stringify(initial)],[selectionKey,JSON.stringify(selected)]]);
  const live=new Map([first,second,protectedFile,remaining,outside].map(item=>[item.id,item]));
  const removed=new Map([[prior.id,prior]]);
  const calls=[],events=[],storageDeletes=[],workerClaims=[],purgeResponses=[],receiptReads=[],notices=[];
  let claimed=null,held=false,readinessChecks=0;
  const worker=createMediaCleanup({url:origin,publishable:'fixture-public',service:'fixture-service',cronSecret:'fixture-cron',warn:()=>{},
    async fetcher(url,init){
      const path=new URL(url).pathname,args=init.body&&JSON.parse(init.body);
      if(path.endsWith('/auth/v1/user')){
        assert.equal(init.headers.Authorization,'Bearer owner-fixture');
        return Response.json({id:owner});
      }
      if(path.endsWith('_management')){
        assert.deepEqual(args,{p_action:'authorize'});
        return Response.json({actor:owner});
      }
      if(path.endsWith('_claim')){
        assert.equal(claimed,null);
        claimed=live.get(args.p_item);
        assert.ok(claimed);
        assert.deepEqual(args,{p_actor:owner,p_item:claimed.id,p_expiry:claimed.expires_at});
        workerClaims.push(claimed.id);
        return Response.json({status:'ok',id:id(99),items:[{id:claimed.id}]});
      }
      if(path.endsWith('_target')){
        assert.equal(args.p_id,claimed.id);
        if(claimed.id===protectedFile.id){held=true;return Response.json(null);}
        return Response.json({bucket:claimed.bucket,name:claimed.name,present:true});
      }
      if(init.method==='DELETE'){
        assert.equal(path,'/storage/v1/object/'+claimed.bucket);
        assert.deepEqual(args,{prefixes:[claimed.name]});
        storageDeletes.push(claimed.id);
        return Response.json([{name:claimed.name}]);
      }
      if(path.endsWith('_settle')){
        assert.equal(args.p_id,claimed.id);
        assert.equal(args.p_ok,true);
        removed.set(claimed.id,claimed);
        live.delete(claimed.id);
        return Response.json(true);
      }
      if(path.endsWith('_finish')){claimed=null;return Response.json(0);}
      throw new Error('Unexpected worker fixture request');
    },
  });
  const db={rpc(name,args){return {abortSignal:async()=>{
    if(name==='home_media_trash_receipt'){
      receiptReads.push(args.p_id);
      assert.equal(args.p_expiry,expires_at);
      return {data:{status:held&&args.p_id===protectedFile.id?'protected':'eligible'}};
    }
    if(args.p_action==='trash_manifest')return {data:{items:[...live.values()]}};
    if(args.p_action==='readiness'){readinessChecks++;return {data:{crossAppProtection:true}};}
    if(args.p_action==='overview')return {data:{panelVersion:2,objects:live.size,bytes:0,candidates:0,candidateBytes:0,
      abandoned:0,activeUploads:0,broken:0,enabled:true,crossAppProtection:true,earlyEligible:live.size,overdue:0,
      trashed:live.size,checkedAt:new Date().toISOString()}};
    const items=args.p_action==='trash_page'?[...live.values()].map(item=>({...item,state:'trashed',restore_mode:'file',
      purge_block:held&&item.id===protectedFile.id?'owner_hold':null})):
      args.p_action==='removed_page'?[...removed.values()].map(item=>({...item,removed_at:new Date().toISOString()})):null;
    assert.ok(items);
    return {data:{items,hasMore:false,available:true}};
  }};}};
  const {POST}=load('storage-media-route',{
    '@/lib/server':{backendConfig:()=>({url:origin,key:'fixture-public'})},
    '@/lib/property-photo-files':{PROPERTY_IMAGE_ORIGIN:origin},
    '@/lib/staff-server':{StaffRequestError:class extends Error{},staffRequest:async req=>{
      assert.equal(req.headers.get('authorization'),'Bearer owner-fixture');
      return {db,role:'owner'};
    }},
    '@/lib/home-media-request':storageMedia,'@/lib/requests':requests,
  },vm.createContext({URL,Response,fetch:(url,init)=>worker(new Request(url,init))}));
  const context=vm.createContext({
    Date,Error,AbortController,performance,setTimeout,clearTimeout,setInterval,clearInterval,
    localStorage:{getItem:k=>store.get(k)??null,setItem:(k,value)=>store.set(k,value)},
    navigator:{locks:{request:async(_name,_options,callback)=>callback({})}},
    window:{addEventListener(){},removeEventListener(){},confirm(message){events.push('confirm');assert.match(message,/4 selected files.*1 changed/);return true;}},
    async fetch(path,init){
      assert.equal(path,'/api/admin/storage-media');
      const args=JSON.parse(init.body);
      calls.push(args);events.push(args.action);
      if(args.action==='purge'){
        const checkpoint=trash.readTrashRun(store.get(key));
        assert.equal(trash.pendingTrashRequest(checkpoint).id,args.id);
        if(args.id===second.id){
          assert.equal(checkpoint.entries[1].outcome,'removed');
          assert.ok(!JSON.parse(store.get(selectionKey)).some(item=>item.id===first.id));
        }
      }
      const response=await POST(new Request(origin+path,init));
      if(args.action==='purge')purgeResponses.push([response.status,await response.clone().json()]);
      return response;
    },
  });
  const site={t:en=>en,language:'en',user:{id:owner},notice:message=>notices.push(message),
    editorTask:operation=>operation({auth:{getSession:async()=>({data:{session:{access_token:'owner-fixture'}}})}},new AbortController().signal)};
  const mocks={'@/lib/home-media-trash':trash,'./site-context':{useSite:()=>site},'./ui/dropdown-menu':dropdown,
    '@/lib/property-photo-files':{PROPERTY_IMAGE_ORIGIN:origin},'./storage-orphan-review':{StorageOrphanReview:()=>null}};
  mocks['./media-selection']=load('media-selection',mocks,context);
  mocks['./media-removal-progress']=load('media-removal-progress',mocks,context);
  const {StorageMediaManagement}=load('listing-deletion-queue',mocks,context);
  let view;
  const button=label=>view.root.findAllByType('button').find(node=>node.children.join('')===label);
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  try{
    await act(async()=>{view=TestRenderer.create(React.createElement(StorageMediaManagement,{visible:true,latest:null,onListingRestored:()=>{}}));});
    await act(async()=>view.root.findByType('details').props.onToggle({currentTarget:{open:true}}));
    await act(async()=>button('File Trash').props.onClick());
    assert.equal(button('Permanently delete selected').props.disabled,false);
    await act(async()=>button('Permanently delete selected').props.onClick());
    const attempted=[first,second,protectedFile,outside];
    assert.deepEqual(calls.filter(call=>call.action==='purge'),attempted.map(item=>({
      action:'purge',id:item.id,expiresAt:expires_at,confirm:true,
    })));
    assert.deepEqual(events.slice(events.indexOf('trash_manifest'),events.indexOf('purge')),['trash_manifest','confirm']);
    assert.equal(events.filter(event=>event==='confirm').length,1);
    assert.equal(events.filter(event=>event==='trash_manifest').length,1);
    assert.equal(readinessChecks,4);
    assert.deepEqual(workerClaims,attempted.map(item=>item.id));
    assert.deepEqual(storageDeletes,[first.id,second.id,outside.id]);
    assert.deepEqual(receiptReads,[protectedFile.id]);
    assert.deepEqual(purgeResponses.map(([status])=>status),[200,200,409,200]);
    assert.deepEqual(purgeResponses[2][1],{error:'purge_unconfirmed'});
    assert.equal(purgeResponses[3][1].removed,1);
    const checkpoint=trash.readTrashRun(store.get(key));
    assert.equal(checkpoint.confirmedAt,initial.confirmedAt);
    assert.deepEqual(checkpoint.timing,initial.timing);
    assert.equal(checkpoint.state,'paused');
    assert.equal(trash.pendingTrashRequest(checkpoint),undefined);
    assert.deepEqual(checkpoint.entries.map(item=>[item.id,item.outcome]),[
      [prior.id,'removed'],[first.id,'removed'],[second.id,'removed'],[protectedFile.id,'pending'],[remaining.id,'pending'],
    ]);
    assert.equal(trash.trashRunTotals(checkpoint).reclaimedBytes,600_000);
    assert.deepEqual(JSON.parse(store.get(selectionKey)),[]);
    assert.deepEqual(notices,['Permanently deleted 3 of 5 selected files (1.1 MB).']);
    assert.ok(calls.some(call=>call.action==='removed_page'));
    assert.ok(live.has(protectedFile.id));
    assert.ok(live.has(remaining.id));
  }finally{
    if(view)await act(async()=>view.unmount());
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});

test('Orphan Review resets applied search and selects eligible files across pages',async()=>{
  const storage=new Map();
  const context=vm.createContext({localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}});
  const site={t:en=>en,language:'en',user:{id:'owner'}};
  const mocks={'@/lib/home-media-trash':trash,'./site-context':{useSite:()=>site},'./ui/dropdown-menu':dropdown};
  mocks['./media-selection']=load('media-selection',mocks,context);
  const {StorageOrphanReview}=load('storage-orphan-review',mocks,context);
  const calls=[];
  const request=async args=>{
    calls.push(args);
    return {items:[{bucket:'property-media',key:`file-${args.offset}.webp`,objectId:`id-${args.offset}`,
      version:'1',etag:'etag',bytes:2000,held:false,reason:'potential'}],available:true,hasMore:args.offset===0,holds:0};
  };
  const chosen=()=>JSON.parse(storage.get('gary-home:media:owner:orphan-selection')??'[]').map(row=>row.key);
  let view;
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  try{
    await act(async()=>{view=TestRenderer.create(React.createElement(StorageOrphanReview,{request,disabled:false,onStaged:()=>{}}));});
    const search=()=>view.root.findByProps({type:'search'});
    await act(async()=>search().props.onChange({target:{value:'sample'}}));
    await act(async()=>view.root.findByProps({role:'search'}).props.onSubmit({preventDefault(){}}));
    assert.equal(calls.at(-1).query,'sample');
    const pick=label=>view.root.findAllByProps({role:'menuitem'}).find(item=>item.children.join('')===label);
    await act(async()=>pick('Select all eligible files').props.onSelect());
    assert.deepEqual(calls.slice(-2).map(({query,offset})=>[query,offset]),[['sample',0],['sample',30]]);
    assert.deepEqual(chosen(),['file-0.webp','file-30.webp']);
    await act(async()=>view.root.findByProps({'aria-label':'Clear search'}).props.onClick());
    assert.equal(calls.at(-1).query,'');
    await act(async()=>view.root.findByProps({'aria-label':'Select eligible files on this page'}).props.onChange());
    assert.deepEqual(chosen(),['file-30.webp']);
    await act(async()=>pick('Clear selection').props.onSelect());
    assert.deepEqual(chosen(),[]);
  }finally{
    if(view)await act(async()=>view.unmount());
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
