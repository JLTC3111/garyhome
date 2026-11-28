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
import * as observationWorkflow from '../lib/home-media-observation.ts';
import * as storageMedia from '../lib/home-media-request.ts';
import * as requests from '../lib/requests.ts';
import { createMediaCleanup } from '../supabase/functions/media-orphan-cleanup/worker.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const textOf = node => typeof node==='string'?node:node.children.map(textOf).join('');
const require = createRequire(import.meta.url);
const openedDetails = () => {
  const details={open:true};
  return {target:details,currentTarget:details};
};
const names = ['media-removal-progress', 'media-selection', 'listing-deletion-queue', 'storage-orphan-review'];
const sources = [...names.map(name => [name,`components/${name}.tsx`]), ['storage-media-route','app/api/admin/storage-media/route.ts']];
const components = new Map(sources.map(([name,path]) => [name, new vm.Script('(function(exports,require,module){' +
  ts.transpileModule(read(path), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText + '\n})')]));
function load(name, mocks, context) {
  const module = { exports: {} };
  components.get(name).runInContext(context)(module.exports, id =>
    id==='@/lib/home-media-observation'?observationWorkflow:mocks[id] ?? require(id), module);
  return module.exports;
}

const dropdown = {
  DropdownMenu:({children})=>children,
  DropdownMenuTrigger:({children})=>children,
  DropdownMenuContent:({children})=>children,
  DropdownMenuItem:({children,...props})=>React.createElement('div',{...props,role:'menuitem'},children),
};

test('Owners can release one hold or confirm a bulk release and deletion from the live preview',async()=>{
  const rows=new Map(['release','first','second'].map((name,index)=>{
    const ticket={bucket:'property-media',name:`archive/${name}.webp`,objectId:`file-${index}`,
      version:'fixture',heldAt:'2026-11-28T08:00:00Z',bytes:100};
    return [name,{...ticket,status:'recovery',reason:'recovery_hold',object_id:ticket.objectId,recovery_target:ticket}];
  }));
  let confirmed=false;
  const mutations=[],confirmations=[],store=new Map();
  const context=vm.createContext({
    Date,Error,AbortController,performance,setTimeout,clearTimeout,setInterval,clearInterval,navigator:{},
    localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
    window:{addEventListener(){},removeEventListener(){},confirm:message=>{confirmations.push(message);return confirmed;}},
    async fetch(_, {body}){
      const args=JSON.parse(body),retentionCounts={recovery:rows.size};
      switch(args.action){
        case 'worker_status':return Response.json({status:'ok',manualUnused:true,manualRecovery:true});
        case 'observation_status':return Response.json({status:'idle',cycle:1,checked:0,total:0,recorded:0,reset:0});
        case 'overview':return Response.json({panelVersion:2,objects:rows.size,candidates:0,candidateBytes:0,bytes:300,
          activeUploads:0,broken:0,enabled:true,crossAppProtection:true,earlyEligible:0,overdue:0,trashed:0,retentionCounts});
        case 'inventory_page':
        case 'retention_page':
          return Response.json({items:[...rows.values()],available:true,hasMore:false,manualCount:0,
            counts:{all:rows.size,...retentionCounts},retentionCounts,automatic:false});
        case 'retention_manifest':return Response.json({items:[],recoveryItems:[...rows.values()].map(row=>row.recovery_target)});
        case 'release_recovery':
        case 'purge_recovery': {
          assert.equal(args.confirm,true);
          const name=args.target.name.split('/').at(-1).replace('.webp','');
          assert.deepEqual(args.target,rows.get(name).recovery_target);
          mutations.push([args.action,name]);
          rows.delete(name);
          return Response.json(args.action==='release_recovery'?{status:'released'}:{status:'ok',removed:1});
        }
        case 'removed_page':return Response.json({items:[],hasMore:false,available:true});
        default:assert.fail('Unexpected action '+args.action);
      }
    },
  });
  const site={t:en=>en,language:'en',user:{id:'owner'},notice:()=>{},
    editorTask:operation=>operation({auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})}},new AbortController().signal)};
  const mocks={'@/lib/home-media-trash':trash,'./site-context':{useSite:()=>site},'./ui/dropdown-menu':dropdown,
    '@/lib/property-photo-files':{PROPERTY_IMAGE_ORIGIN:'https://fixture.example'},'./storage-orphan-review':{StorageOrphanReview:()=>null}};
  mocks['./media-selection']=load('media-selection',mocks,context);
  mocks['./media-removal-progress']=load('media-removal-progress',mocks,context);
  const {StorageMediaManagement}=load('listing-deletion-queue',mocks,context);
  let view;
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  try {
    await act(async()=>{view=TestRenderer.create(React.createElement(StorageMediaManagement,{visible:true,latest:null,onListingRestored:()=>{}}));});
    await act(async()=>view.root.findByType('details').props.onToggle(openedDetails()));
    const button=label=>view.root.findAllByType('button').find(node=>textOf(node)===label);
    const filter=()=>view.root.findByProps({'data-file-filter':'recovery'});
    await act(async()=>button('Retention preview').props.onClick());
    assert.equal(textOf(filter().findByType('b')),'3');
    await act(async()=>view.root.findByProps({'aria-label':'Release hold for release.webp'}).props.onClick());
    assert.deepEqual(mutations,[]);
    confirmed=true;
    await act(async()=>view.root.findByProps({'aria-label':'Release hold for release.webp'}).props.onClick());
    assert.equal(textOf(filter().findByType('b')),'2');
    await act(async()=>filter().props.onClick());
    await act(async()=>view.root.findByProps({role:'menuitem','aria-label':'Select all eligible files'}).props.onSelect());
    confirmed=false;
    await act(async()=>button('Release holds & delete selected').props.onClick());
    assert.deepEqual(mutations,[['release_recovery','release']]);
    assert.match(confirmations.at(-1),/permanently delete 2 selected files/);
    confirmed=true;
    await act(async()=>button('Release holds & delete selected').props.onClick());
    assert.deepEqual(mutations,[['release_recovery','release'],['purge_recovery','first'],['purge_recovery','second']]);
    assert.equal(textOf(filter().findByType('b')),'0');
    await act(async()=>button('Inventory files').props.onClick());
    assert.equal(textOf(filter().findByType('b')),'0');
  }finally{
    if(view)await act(async()=>view.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT=false;
  }
});
const css = name => postcss.parse(read(`app/${name}.css`));
const globals = css('globals'), publicTheme = css('public-theme'), studio = css('studio-theme'), panelCss = css('listing-management'), actions = css('action-buttons');
const styles = (tree, selector) => Object.fromEntries(tree.nodes.find(node => node.selectors?.includes(selector)).nodes
  .filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
function palette(theme) {
  const tokens = {...styles(globals, ':root'), ...styles(publicTheme, ':root'), ...styles(studio, 'html:has(.admin-shell)'), ...styles(actions, ':root')};
  if (theme === 'dark') Object.assign(tokens, styles(studio,
    'html[data-home-theme="dark"]:not([data-home-public="true"]):has(.admin-shell, .session-gate, .page-loading)'),styles(actions,'html[data-home-theme="dark"]'));
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
    verify('Warning button', 'var(--action-archive-ink)', 'var(--action-archive-tint)', 4.5);
    verify('Destructive button', 'var(--action-white)', 'var(--action-red)', 4.5);
    for(const state of ['loading','paused','failed','disabled']){
      const stateFill=styles(panelCss, `.storage-media-meter[data-progress-state="${state}"] .storage-removal-progress__fill`);
      verify(`${state} progress`, stateFill.background, track.background, 3);
    }
    const completedSelector='.storage-media-meter[data-progress-state="completed"] .storage-removal-progress__fill';
    verify('completed progress', styles(panelCss, theme==='dark'?`html[data-home-theme="dark"] ${completedSelector}`:completedSelector).background, track.background, 3);
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
            {name:'fixtures/tour % clip.mp4',bucket:'listing-videos',object_id:'tour',reason:'waiting',eligible_at:expires_at,bytes:200},
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
    const button = label => view.root.findAllByType('button').find(node=>textOf(node)===label);
    const state = () => view.root.findByProps({className:'storage-removal-progress'}).props['data-state'];
    const click = async label => act(async()=>button(label).props.onClick());
    const filter = async value => act(async()=>view.root.findByProps({type:'search'}).props.onChange({target:{value}}));
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async()=>{view = TestRenderer.create(page(true));});
      await act(async()=>{view.root.findByType('details').props.onToggle(openedDetails());});
      await click('Retention preview');
      const retentionLabels=view.root.findAllByType('small').map(node=>node.children.join(''));
      assert.ok(retentionLabels.some(label=>label.includes('Protected for recovery.')));
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
      assert.deepEqual(view.root.findAllByProps({role:'menuitem'}).map(item=>item.props['aria-label']),
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
          assert.equal(checkpoint.entries.find(item=>item.id===first.id).outcome,'removed');
          assert.equal(checkpoint.returnTo?.confirmedAt,initial.confirmedAt);
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
  const button=label=>view.root.findAllByType('button').find(node=>textOf(node)===label);
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  try{
    await act(async()=>{view=TestRenderer.create(React.createElement(StorageMediaManagement,{visible:true,latest:null,onListingRestored:()=>{}}));});
    await act(async()=>view.root.findByType('details').props.onToggle(openedDetails()));
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
    const pick=label=>view.root.findByProps({role:'menuitem','aria-label':label});
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

test('Inventory Files loads exact previews on demand and shares single and batch removal with Retention Preview',async()=>{
  const source='unused_listing',expires_at=new Date(Date.now()+3600000).toISOString();
  const files=[
    {id:'first',bucket:'property-media',name:'fixtures/first photo #1.webp',bytes:100_000},
    {id:'second',bucket:'property-media',name:'fixtures/second.webp',bytes:200_000},
    {id:'tour',bucket:'listing-videos',name:'fixtures/tour % clip.mp4',bytes:300_000},
    ...Array.from({length:68},(_,index)=>({id:`extra-${index}`,bucket:'property-media',name:`fixtures/extra-${index}.webp`,bytes:100_000})),
  ].map(file=>({...file,expires_at,source}));
  const live=new Map(files.map(file=>[file.id,file]));
  const verified=new Set(['tour']),total=files.length+2;
  const held={name:'fixtures/recovery.webp',bucket:'property-media',reason:'recovery_hold',listing_code:'GH-645',listing_title_en:'Recovery draft',saved_reference:false,object_id:'held',bytes:120};
  const alias={name:'fixtures/alias.jpg',bucket:'property-media',reason:'filename_match',listing_code:'GH-ALIAS',
    listing_title_en:'Published courtyard',saved_reference:false,object_id:'alias',bytes:80};
  const calls=[],confirmations=[],store=new Map();
  let inventoryTimeout=true;
  let observation={status:'idle',cycle:0,checked:0,total:0,recorded:0,reset:0,lastSuccessfulAt:null,error:null};
  let verificationRequests=0,verifyingBatch=false,releaseVerification,releaseRemoval;
  let delayRetentionRefresh=false,releaseOldPage;
  const context=vm.createContext({
    Date,Error,AbortController,performance,setTimeout,clearTimeout,setInterval,clearInterval,navigator:{},
    localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
    window:{addEventListener(){},removeEventListener(){},confirm:message=>{confirmations.push(message);return true;}},
    async fetch(_, {body}){
      const args=JSON.parse(body);
      calls.push(args);
      const items=[...live.values()];
      switch(args.action){
        case 'worker_status': return Response.json({status:'ok',cronConfigured:true,manualUnused:true});
        case 'observation_status': return Response.json(observation);
        case 'verify_unused': {
          assert.deepEqual({cycle:args.cycle,checked:args.checked,start:args.start},
            {cycle:observation.cycle,checked:observation.checked,start:observation.status==='idle'});
          verificationRequests++;
          verifyingBatch=true;
          if(verificationRequests<3)await new Promise(resolve=>{releaseVerification=resolve;});
          const checked=Math.min(observation.checked+32,total),complete=checked===total;
          for(const item of files.slice(0,checked))verified.add(item.id);
          if(verificationRequests===1)live.set('tour',{...live.get('tour'),bytes:310_000});
          observation={...observation,cycle:1,status:complete?'complete':'running',checked,total,
            recorded:verified.size-1,lastSuccessfulAt:complete?'2026-11-27T17:00:00Z':null};
          verifyingBatch=false;
          if(verificationRequests===2)return Response.json({error:'observation_timeout'},{status:504});
          return Response.json(observation);
        }
        case 'overview': return Response.json({panelVersion:2,objects:items.length+3,bytes:items.reduce((sum,item)=>sum+item.bytes,120),
          candidates:0,candidateBytes:0,abandoned:0,activeUploads:0,broken:0,enabled:true,crossAppProtection:true,earlyEligible:0,
          overdue:0,trashed:2,checkedAt:new Date().toISOString()});
        case 'inventory_page':
        case 'retention_page': {
          if(args.action==='inventory_page'&&inventoryTimeout)return Response.json({error:'inventory_timeout'},{status:504});
          const rows=[held,alias,...items.map(item=>({
          ...item,manual_target:verified.has(item.id)?item:null,reason:verified.has(item.id)?'waiting':'awaiting_observation',
          eligible_at:verified.has(item.id)?item.expires_at:null,listing_code:'GH-FIXTURE',
          listing_title_en:'Lake view fixture',saved_reference:false,object_id:item.id,
          }))];
          const offset=args.offset??0;
          const page={items:rows.slice(offset,offset+30),hasMore:rows.length>offset+30,
            available:true,manualCount:items.filter(item=>verified.has(item.id)).length,automatic:false};
          if(args.action==='retention_page'&&delayRetentionRefresh){
            delayRetentionRefresh=false;
            await new Promise(resolve=>{releaseOldPage=resolve;});
            return Response.json({...page,items:page.items.map(row=>row.id==='tour'?
              {...row,manual_target:null,reason:'awaiting_observation'}:row)});
          }
          return Response.json(page);
        }
        case 'retention_receipt':
          assert.equal(verifyingBatch,false,'a requested removal waits for the active observation write');
          return Response.json({status:live.has(args.id)&&verified.has(args.id)?'eligible':'already_removed',bytes:live.get(args.id)?.bytes});
        case 'retention_manifest':return Response.json({items:items.filter(item=>verified.has(item.id))});
        case 'purge_unused':
          assert.equal(args.confirm,true);
          assert.equal(verifyingBatch,false);
          assert.equal(live.get(args.id)?.expires_at,args.expiresAt);
          if(args.id==='first')await new Promise(resolve=>{releaseRemoval=resolve;});
          live.delete(args.id);
          return Response.json({status:'ok',attempted:1,removed:1});
        case 'removed_page':return Response.json({items:[],hasMore:false,available:true});
        default:assert.fail('Unexpected action '+args.action);
      }
    },
  });
  const site={t:en=>en,language:'en',user:{id:'owner'},notice:()=>{},
    editorTask:operation=>operation({auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})}},new AbortController().signal)};
  const mocks={'@/lib/home-media-trash':trash,'./site-context':{useSite:()=>site},'./ui/dropdown-menu':dropdown,
    '@/lib/property-photo-files':{PROPERTY_IMAGE_ORIGIN:'https://fixture.example'},'./storage-orphan-review':{StorageOrphanReview:()=>null}};
  mocks['./media-selection']=load('media-selection',mocks,context);
  mocks['./media-removal-progress']=load('media-removal-progress',mocks,context);
  const {StorageMediaManagement}=load('listing-deletion-queue',mocks,context);
  let view;
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  try {
    await act(async()=>{view=TestRenderer.create(React.createElement(StorageMediaManagement,{visible:true,latest:null,onListingRestored:()=>{}}));});
    await act(async()=>view.root.findByType('details').props.onToggle(openedDetails()));
    const button=label=>view.root.findAllByType('button').find(node=>textOf(node)===label);
    await act(async()=>button('Inventory files').props.onClick());
    assert.match(view.root.findByProps({role:'alert'}).children.join(''),/request timed out/);
    assert.equal(view.root.findAllByType('p').some(node=>node.children.join('')==='No records on this page.'),false);
    inventoryTimeout=false;
    await act(async()=>button('Refresh this list').props.onClick());
    assert.equal(view.root.findAllByProps({role:'alert'}).length,0);
    const observationPanel=()=>view.root.findByProps({className:'storage-media-observation'});
    const filter=name=>view.root.findByProps({'data-file-filter':name});
    const chooseFilter=async name=>act(async()=>filter(name).props.onClick());
    const visibleCount=name=>textOf(filter(name).findByType('b'));
    const menuOptions=()=>view.root.findAllByProps({role:'menuitem'});
    const tour=()=>view.root.findByProps({'aria-label':'Select tour % clip.mp4'});
    assert.deepEqual(['all','verified','protected','awaiting','recovery'].map(visibleCount),['30','1','2','27','1']);
    await chooseFilter('awaiting');
    assert.equal(filter('awaiting').props['aria-pressed'],true);
    assert.equal(view.root.findAllByProps({'aria-label':'Select recovery.webp'}).length,0);
    assert.ok(menuOptions().every(item=>item.props.disabled));
    assert.match(textOf(menuOptions()[0]),/Run verification to find out which files can be selected/);
    await chooseFilter('all');
    assert.equal(view.root.findByProps({'aria-label':'Select first photo #1.webp'}).props.disabled,true);
    await act(async()=>button('Verify unused files').props.onClick());
    assert.equal(button('Verifying…').props.disabled,true);
    assert.equal(verificationRequests,1);
    assert.equal(tour().props.disabled,false);
    await act(async()=>tour().props.onChange({target:{checked:true}}));
    await act(async()=>button('Retention preview').props.onClick());
    assert.equal(tour().props.checked,true);
    assert.equal(tour().props.disabled,false);
    await act(async()=>button('Pause verification').props.onClick());
    assert.equal(button('Pausing…').props.disabled,true);
    delayRetentionRefresh=true;
    await act(async()=>releaseVerification());
    assert.equal(typeof releaseOldPage,'function');
    await act(async()=>button('Inventory files').props.onClick());
    await act(async()=>releaseOldPage());
    assert.equal(button('Inventory files').props['aria-pressed'],true);
    assert.equal(observationPanel().findByProps({role:'progressbar'}).props['aria-valuenow'],43);
    assert.equal(observationPanel().props['data-progress-state'],'paused');
    assert.match(textOf(observationPanel().findByProps({className:'storage-media-meter__summary'})),/43%.*Elapsed.*Remaining files.*41/);
    assert.match(observationPanel().findByProps({role:'status'}).children.join(''),/32 of 73 checked/);
    assert.equal(store.get('gary-home:media:owner:observation-cycle'),'1');
    assert.equal(tour().props.checked,true);
    assert.equal(JSON.parse(store.get('gary-home:media:owner:unused-selection'))[0].bytes,310_000);
    assert.equal(view.root.findByProps({'aria-label':'Select first photo #1.webp'}).props.disabled,false);
    assert.ok(!calls.some(call=>['run','purge_unused','purge','trash'].includes(call.action)));
    await act(async()=>view.unmount());
    await act(async()=>{view=TestRenderer.create(React.createElement(StorageMediaManagement,{visible:true,latest:null,onListingRestored:()=>{}}));});
    await act(async()=>view.root.findByType('details').props.onToggle(openedDetails()));
    await act(async()=>button('Inventory files').props.onClick());
    assert.equal(tour().props.checked,true);
    const preview=filename=>view.root.findByProps({'aria-label':'Preview '+filename}).parent;
    await act(async()=>preview('first photo #1.webp').props.onToggle(openedDetails()));
    assert.equal(view.root.findByType('img').props.src,'https://fixture.example/storage/v1/object/public/property-media/fixtures/first%20photo%20%231.webp');
    await act(async()=>button('Resume verification').props.onClick());
    const removeFirst=()=>view.root.findByProps({'aria-label':'Permanently delete first photo #1.webp'});
    assert.equal(removeFirst().props.disabled,false);
    await act(async()=>removeFirst().props.onClick());
    assert.ok(!calls.some(call=>call.action==='retention_receipt'));
    await act(async()=>releaseVerification());
    assert.equal(verificationRequests,2,'verification waits while the confirmed removal runs');
    assert.equal(typeof releaseRemoval,'function');
    await act(async()=>releaseRemoval());
    assert.equal(live.size,70);
    assert.equal(tour().props.checked,true);
    assert.equal(observationPanel().findAllByProps({role:'alert'}).length,0);
    assert.match(observationPanel().findByProps({role:'status'}).children.join(''),/73 of 73 checked.*70 newly verified/);
    assert.equal(observationPanel().props['data-progress-state'],'completed');
    assert.equal(store.has('gary-home:media:owner:observation-cycle'),false);
    assert.equal(observationPanel().findByType('strong').children.join(''),
      new Intl.DateTimeFormat('en',{dateStyle:'medium',timeStyle:'short'}).format(new Date(observation.lastSuccessfulAt)));
    assert.equal(calls.filter(call=>call.action==='verify_unused').length,3);
    assert.equal(confirmations.length,1);
    inventoryTimeout=true;
    await act(async()=>button('Refresh inventory').props.onClick());
    assert.match(view.root.findByProps({role:'alert'}).children.join(''),/timed out.*Showing the last loaded files/);
    assert.equal(view.root.findByProps({'aria-label':'Permanently delete second.webp'}).props.disabled,true);
    inventoryTimeout=false;
    await act(async()=>button('Refresh this list').props.onClick());
    assert.deepEqual(['all','verified','protected','awaiting','recovery'].map(visibleCount),['30','28','2','0','1']);
    await chooseFilter('recovery');
    assert.equal(view.root.findAllByProps({'aria-label':'Select alias.jpg'}).length,0);
    const recovery=view.root.findByProps({'aria-label':'Select recovery.webp'});
    assert.equal(recovery.props.disabled,true);
    assert.match(textOf(recovery.parent),/Unavailable/);
    assert.deepEqual(menuOptions().map(item=>item.props.disabled),[true,true,false]);
    assert.match(textOf(menuOptions()[0]),/Release a recovery hold before verifying/);
    assert.equal(view.root.findByProps({'aria-label':'Selection options'}).props.title,undefined);
    assert.equal(view.root.findByProps({className:'storage-media-selection__master'}).props.title,undefined);
    await chooseFilter('protected');
    const cannotDelete=view.root.findByProps({'aria-label':'Permanently delete alias.jpg'});
    assert.equal(cannotDelete.props.disabled,true);
    assert.equal(cannotDelete.props.title,undefined);
    assert.match(textOf(view.root.findByProps({id:cannotDelete.props['aria-describedby']})),/saved filename could refer to this file/);
    assert.match(textOf(menuOptions()[0]),/Protected files cannot be selected/);
    const smallLabels=view.root.findAllByType('small').map(node=>node.children.join(''));
    assert.ok(smallLabels.includes('GH-ALIAS · Published courtyard'));
    assert.ok(smallLabels.includes('Exact saved references · none'));
    await chooseFilter('verified');
    assert.equal(view.root.findAllByProps({'aria-label':'Select alias.jpg'}).length,0);
    assert.equal(tour().props.disabled,false);
    assert.match(textOf(tour().parent),/Select/);
    assert.ok(view.root.findAllByType('p').some(node=>/70 files eligible across all pages for this search/.test(textOf(node))));
    assert.deepEqual(menuOptions().map(item=>item.props.disabled),[false,false,false]);
    assert.equal(view.root.findAllByType('video').length,0);
    assert.equal(view.root.findAllByType('img').length,0);
    await act(async()=>preview('tour % clip.mp4').props.onToggle(openedDetails()));
    assert.equal(view.root.findByType('video').props.src,'https://fixture.example/storage/v1/object/public/listing-videos/fixtures/tour%20%25%20clip.mp4');
    assert.equal(view.root.findAllByType('img').length,0);
    const selectAll=view.root.findByProps({role:'menuitem','aria-label':'Select all eligible files'});
    assert.ok(selectAll);
    await act(async()=>selectAll.props.onSelect({preventDefault(){}}));
    await act(async()=>button('Permanently delete selected').props.onClick());
    assert.equal(live.size,0);
    assert.equal(visibleCount('verified'),'0');
    assert.match(textOf(view.root.findByProps({className:'storage-media-empty'})),/No verified unused files to remove/);
    assert.ok(menuOptions().every(item=>item.props.disabled));
    const sent=calls.filter(call=>call.action==='purge_unused');
    assert.deepEqual(sent.map(call=>call.id),['first','tour','second',...files.slice(3).map(file=>file.id)]);
    assert.equal(confirmations.length,2);
    assert.ok(confirmations[1].includes('70 verified unused files'));
    const firstBatchRemoval=calls.findIndex(call=>call.id==='second'&&call.action==='purge_unused');
    assert.equal(calls[firstBatchRemoval+1].action,'purge_unused');
    const counters=view.root.findByProps({className:'storage-media-stats'}).findAllByType('dd');
    assert.equal(counters[0].children.join(''),'3');
    assert.ok(calls.filter(call=>call.action==='inventory_page').length>=3);
    assert.ok(calls.some(call=>call.action==='removed_page'));
    await act(async()=>button('Retention preview').props.onClick());
    assert.equal(view.root.findByProps({'aria-label':'Permanently delete recovery.webp'}).props.disabled,true);
    const journal=trash.readTrashRun(store.get('gary-home:media:owner:trash-run'));
    assert.equal(trash.trashRunTotals(journal).reclaimedBytes,7_310_000);
  } finally {
    if(view)await act(async()=>view.unmount());
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
