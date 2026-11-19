import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import ts from 'typescript';
import {LANGUAGE_BOOTSTRAP,persistLanguage} from '../lib/language.ts';

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);

function loadComponents(site){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const loadedModule={exports:{}};cache.set(file,loadedModule);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  function dependency(id){
   if(id==='next/image')return {__esModule:true,default:props=>React.createElement('img',props)};
   if(id==='./site-context')return {useSite:()=>site.current};
   if(id.startsWith('.')||id.startsWith('@/')){const target=id.startsWith('@/')?path.join(root,id.slice(2)):path.resolve(path.dirname(file),id);return load([target,target+'.ts',target+'.tsx'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile()));}
   return require(id);
  }
  vm.runInThisContext('(function(exports,require,module){'+source+'\n})',{filename:file})(loadedModule.exports,dependency,loadedModule);
  return loadedModule.exports;
 }
 return {gallery:load(path.join(root,'components/property-gallery.tsx'))};
}

async function platform(t,thumbs=null){
 const old=new Map(),stored=new Map();
 class HTMLElement {focus(){page.activeElement=this;this.focused=true;}}
 const opener=new HTMLElement(),first=new HTMLElement(),last=new HTMLElement();
 const page={body:{style:{overflow:'clip'}},activeElement:opener,documentElement:{lang:'en',dataset:{}},cookie:''};
 const values={IS_REACT_ACT_ENVIRONMENT:true,HTMLElement,document:page,window:{location:{protocol:'https:'}},localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)}};
 for(const [key,value]of Object.entries(values)){old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 let renderer;
 t.after(async()=>{if(renderer)await act(async()=>renderer.unmount());for(const [key,value]of old){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
 const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;},querySelectorAll(){return [first,last];}};
 return {page,stored,opener,dialog,first,last,window:values.window,async mount(element){
  await act(async()=>{renderer=TestRenderer.create(element,{createNodeMock:node=>{
   if(node.type==='dialog')return dialog;
   return node.props.className==='rental-lightbox-thumbs'?thumbs:null;
  }});});
  return renderer;
 }};
}

test('gallery survives image shrink/removal, unlocks scrolling and reopens without an undefined photo',async t=>{
 const p=await platform(t),site={current:{t:(en)=>en}}, {gallery:{PropertyGallery}}=loadComponents(site);
 const view=images=>React.createElement(PropertyGallery,{images,title:'A real rental'}),renderer=await p.mount(view(['one.jpg','two.jpg','three.jpg']));
 const button=label=>renderer.root.findAllByType('button').find(n=>n.props['aria-label']===label);
 await act(async()=>button('Open photo 3').props.onClick());
 assert.equal(p.dialog.open,true);assert.equal(p.page.body.style.overflow,'hidden');
 await act(async()=>renderer.update(view(['one.jpg'])));
 const stage=renderer.root.findByProps({className:'rental-lightbox-stage'});
 assert.equal(stage.findByType('img').props.src,'one.jpg');
 await act(async()=>renderer.update(view([])));
 assert.equal(p.dialog.open,false);assert.equal(p.page.body.style.overflow,'clip');
 assert.equal(renderer.root.findAllByType('dialog').length,0);
 const renamed='https://storage.example.test/storage/v1/object/public/property-media/properties/renamed/listing/new.jpg';
 await act(async()=>renderer.update(view([renamed])));
 assert.equal(renderer.root.findByProps({className:'rental-gallery-cover'}).findByType('img').props.src,renamed);
 assert.equal(renderer.root.findByProps({className:'rental-inline-thumbs'}).findByType('img').props.src,renamed);
 await act(async()=>button('Open property gallery').props.onClick());
 assert.equal(p.dialog.open,true);
 assert.equal(renderer.root.findByProps({className:'rental-lightbox-stage'}).findByType('img').props.src,renamed);
 assert.equal(renderer.root.findByProps({className:'rental-lightbox-thumbs'}).findByType('img').props.src,renamed);
 await act(async()=>button('Close gallery').props.onClick());
 assert.equal(p.page.body.style.overflow,'clip');assert.equal(p.opener.focused,true);
});

test('gallery keeps its current image on translation, supports keyboard navigation, traps focus and handles failed photos',async t=>{
 const p=await platform(t),site={current:{t:en=>en}}, {gallery:{PropertyGallery}}=loadComponents(site);
 const view=()=>React.createElement(PropertyGallery,{images:['one.jpg','two.jpg'],title:'Rental'}),renderer=await p.mount(view());
 await act(async()=>renderer.root.findAllByType('button').find(n=>n.props['aria-label']==='Open photo 2').props.onClick());
 site.current.t=(_en,vi)=>vi;await act(async()=>renderer.update(view()));
 const modal=()=>renderer.root.findByType('dialog');
 assert.equal(modal().props['aria-label'],'Thư viện ảnh bất động sản');
 assert.equal(renderer.root.findByProps({className:'rental-lightbox-stage'}).findByType('img').props.src,'two.jpg');
 await act(async()=>modal().props.onKeyDown({key:'ArrowRight',preventDefault(){}}));
 const photo=renderer.root.findByProps({className:'rental-lightbox-stage'}).findByType('img');assert.equal(photo.props.src,'one.jpg');
 await act(async()=>photo.props.onError());
 assert.equal(renderer.root.findByProps({className:'rental-lightbox-stage'}).findAllByType('img').length,0);
 p.page.activeElement=p.last;let prevented=false;
 await act(async()=>modal().props.onKeyDown({key:'Tab',currentTarget:p.dialog,preventDefault(){prevented=true;}}));
 assert.equal(prevented,true);assert.equal(p.page.activeElement,p.first);
 await act(async()=>modal().props.onCancel({preventDefault(){}}));
 assert.equal(p.dialog.open,false);assert.equal(p.page.activeElement,p.opener);assert.equal(p.page.body.style.overflow,'clip');
});

test('fullscreen metadata changes with arrows, keyboard, swipes and thumbnails',async t=>{
 const p=await platform(t),site={current:{t:en=>en,language:'en'}}, {gallery:{PropertyGallery}}=loadComponents(site);
 const images=['/images/front-room.jpg','/images/balcony.jpg','https://storage.example/photos/d2f782a3-1001-4000-8000-112233445566.jpg'];
 const metadata={
  [images[0]]:{description_en:'Morning sun',alt_en:'A sofa by the window',public_filename:'Front room.JPG'},
  [images[1]]:{alt_en:'Overlooking the garden',alt_vi:'Nhìn ra vườn'}
 };
 const view=()=>React.createElement(PropertyGallery,{images,metadata,title:'Rental'});
 const renderer=await p.mount(view());
 const button=label=>renderer.root.findAllByType('button').find(n=>n.props['aria-label']===label);
 const caption=()=>renderer.root.findByProps({className:'rental-lightbox-caption'});
 const modal=()=>renderer.root.findByType('dialog');
 const stage=()=>renderer.root.findByProps({className:'rental-lightbox-stage'});
 await act(async()=>button('Open property gallery').props.onClick());
 assert.equal(caption().findByType('p').props.children,'Morning sun');
 assert.match(caption().findByType('small').props.children.join(''),/Front room.JPG/);
 assert.equal(stage().findByType('img').props.alt,'A sofa by the window');
 assert.ok(modal().children.indexOf(caption())<modal().children.indexOf(renderer.root.findByProps({className:'rental-lightbox-thumbs'})));
 await act(async()=>button('Next photo').props.onClick());
 assert.equal(caption().findByType('p').props.children,'Overlooking the garden');
 await act(async()=>modal().props.onKeyDown({key:'ArrowRight',preventDefault(){}}));
 assert.equal(caption().findByType('p').props.children,'Photo 3 of 3');
 assert.equal(caption().findAllByType('small').length,0);
 const point=(x,y)=>({identifier:1,clientX:x,clientY:y});
 const target={closest:()=>null};
 await act(async()=>{
  stage().props.onTouchStart({target,touches:[point(40,60)]});
  stage().props.onTouchEnd({touches:[],changedTouches:[point(140,65)]});
 });
 assert.equal(caption().findByType('p').props.children,'Overlooking the garden');
 await act(async()=>{
  stage().props.onTouchStart({target,touches:[point(40,60),point(80,60)]});
  stage().props.onTouchEnd({touches:[],changedTouches:[point(150,60)]});
 });
 assert.equal(caption().findByType('p').props.children,'Overlooking the garden');
 await act(async()=>button('Photo 1').props.onClick());
 assert.equal(caption().findByType('p').props.children,'Morning sun');
 site.current={t:(_en,vi)=>vi,language:'vi'};
 await act(async()=>renderer.update(view()));
 await act(async()=>button('Ảnh 2').props.onClick());
 assert.equal(caption().findByType('p').props.children,'Nhìn ra vườn');
});

test('the fullscreen strip scrolls only enough to reveal an overflowing selection',async t=>{
 const images=Array.from({length:5},(_,i)=>`/images/room-${i+1}.jpg`);
 const calls=[];
 let renderer,count=1,resize,reduced=false;
 const strip={
  clientWidth:320,clientLeft:0,scrollLeft:0,
  get scrollWidth(){return Math.max(this.clientWidth,16+count*92+(count-1)*9);},
  getBoundingClientRect(){return {left:20};},
  querySelector(){
   const thumbs=renderer.root.findByProps({className:'rental-lightbox-thumbs'});
   const index=thumbs.children.findIndex(button=>button.props['aria-pressed']);
   return {getBoundingClientRect:()=>{
    const left=20+8+index*101-this.scrollLeft;
    return {left,right:left+92};
   }};
  },
  scrollBy(options){calls.push(options);this.scrollLeft+=options.left;},
  scrollTo({left}){this.scrollLeft=left;}
 };
 const p=await platform(t,strip),site={current:{t:en=>en,language:'en'}}, {gallery:{PropertyGallery}}=loadComponents(site);
 p.window.getComputedStyle=()=>({paddingLeft:'8px',paddingRight:'8px'});
 p.window.matchMedia=()=>({matches:reduced});
 p.window.ResizeObserver=class{constructor(callback){resize=callback;}observe(){}disconnect(){resize=undefined;}};
 const view=()=>React.createElement(PropertyGallery,{images:images.slice(0,count),title:'Rental'});
 renderer=await p.mount(view());
 const click=label=>act(async()=>renderer.root.findByProps({'aria-label':label}).props.onClick());
 await click('Open property gallery');
 for(const size of [1,2,3]){
  count=size;
  await act(async()=>renderer.update(view()));
  await click(`Photo ${size}`);
 }
 assert.deepEqual(calls,[]);

 count=5;
 await act(async()=>renderer.update(view()));
 await click('Photo 5');
 await act(async()=>renderer.root.findByType('dialog').props.onKeyDown({key:'ArrowRight',preventDefault(){}}));
 await click('Photo 3');
 assert.deepEqual(calls,[{left:192,behavior:'smooth'},{left:-192,behavior:'smooth'}]);

 strip.clientWidth=230;
 resize();
 reduced=true;
 await click('Photo 1');
 assert.deepEqual(calls.slice(2),[{left:80,behavior:'auto'},{left:-80,behavior:'auto'}]);
 await click('Close gallery');
 assert.equal(resize,undefined);
});

test('legacy language preferences are migrated before paint and valid language writes persist a secure cookie',async t=>{
 const p=await platform(t);p.stored.set('gary-language','vi');
 vm.runInThisContext(LANGUAGE_BOOTSTRAP);
 assert.equal(p.page.documentElement.dataset.languagePending,'');assert.match(p.page.cookie,/gary-language=vi;.*Secure/);
 persistLanguage('en');assert.equal(p.stored.get('gary-language'),'en');assert.match(p.page.cookie,/gary-language=en;/);
 delete p.page.documentElement.dataset.languagePending;p.stored.set('gary-language','untrusted');
 vm.runInThisContext(LANGUAGE_BOOTSTRAP);assert.equal(p.page.documentElement.dataset.languagePending,undefined);
});

test('the shared language beats stale host preferences on direct portal visits and keeps explicit public URLs readable',()=>{
 const shared={language:'vi'},localCookies={'staff.garyhome.vn':'en','www.garyhome.vn':'en'};
 function visit(hostname,pathname,serverLanguage) {
  const documentElement={lang:serverLanguage,dataset:{}};
  const values=new Map([['gary-language','en']]);
  const document={documentElement,get cookie(){
   return [localCookies[hostname],shared.language].filter(Boolean).map(value=>'gary-language='+value).join('; ');
  },set cookie(line){
   const value=line.split(';')[0].split('=')[1];
   if(line.includes('Max-Age=0')) delete localCookies[hostname];
   else if(line.includes('Domain=garyhome.vn')) shared.language=value;
   else localCookies[hostname]=value;
  }};
  vm.runInNewContext(LANGUAGE_BOOTSTRAP,{document,window:{location:{hostname,pathname,protocol:'https:'}},
   localStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)}});
  return {documentElement,stored:values.get('gary-language')};
 }
 for(const [host,path] of [['staff.garyhome.vn','/admin'],['www.garyhome.vn','/account']]){
  const visited=visit(host,path,'en');
  assert.equal(visited.documentElement.dataset.languagePending,'');
  assert.equal(visited.stored,'vi');
  assert.equal(localCookies[host],undefined);
 }
 assert.equal(visit('www.garyhome.vn','/en','en').documentElement.dataset.languagePending,undefined);
 assert.equal(shared.language,'vi');
});

test('feedback uses an uncropped portrait gallery and keeps landscape navigation and translated controls',async t=>{
 const p=await platform(t),site={current:{t:en=>en}}, {gallery:{PropertyGallery}}=loadComponents(site);const view=()=>React.createElement(PropertyGallery,{images:['portrait-9-16.jpg','landscape.jpg'],title:'Customer feedback',variant:'feedback'}),renderer=await p.mount(view());assert.ok(renderer.root.findByProps({className:'rental-gallery rental-gallery-feedback'}));const cover=renderer.root.findByProps({className:'rental-gallery-cover'}).findByType('img');assert.equal(cover.props.width,900);assert.equal(cover.props.height,1600);
 await act(async()=>renderer.root.findAllByType('button').find(button=>button.props['aria-label']==='Open feedback photos').props.onClick());assert.equal(renderer.root.findByType('dialog').props['aria-label'],'Feedback photo gallery');await act(async()=>renderer.root.findByType('dialog').props.onKeyDown({key:'ArrowRight',preventDefault(){}}));assert.equal(renderer.root.findByProps({className:'rental-lightbox-stage'}).findByType('img').props.src,'landscape.jpg');site.current.t=(_en,vi)=>vi;await act(async()=>renderer.update(view()));assert.equal(renderer.root.findByType('dialog').props['aria-label'],'Thư viện ảnh phản hồi');assert.equal(renderer.root.findByProps({className:'rental-lightbox-stage'}).findByType('img').props.src,'landscape.jpg');
});
