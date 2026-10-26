import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {renderToString} from 'react-dom/server';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
function loader(site){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file).exports;
  if(file.endsWith('.json'))return JSON.parse(fs.readFileSync(file,'utf8'));
  const m={exports:{}};cache.set(file,m);
  const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const dependency=id=>{
   if(id==='next/link')return {__esModule:true,default:({children,...props})=>React.createElement('a',props,children)};
   if(id==='../site-context'||id==='./site-context')return {useSite:()=>site.current};
   // Motion is a rendering boundary here; its spring targets are inspected below.
   if(id==='motion/react'){const li=({children,...props})=>React.createElement('li',props,children);return {m:{li},motion:{li},useInView:()=>true};}
   if(id.startsWith('.')||id.startsWith('@/')){const target=id.startsWith('@/')?path.join(root,id.slice(2)):path.resolve(path.dirname(file),id);return load([target,target+'.ts',target+'.tsx',target+'.json'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile()));}
   return require(id);
  };
  vm.runInThisContext('(function(exports,require,module){'+js+'\n})',{filename:file})(m.exports,dependency,m);return m.exports;
 }
 return load;
}
function platform(t){
 const previous=new Map(),callbacks=new Set(),observers=[];
 const media={matches:false,addEventListener(_type,cb){callbacks.add(cb);},removeEventListener(_type,cb){callbacks.delete(cb);}};
 const values={IS_REACT_ACT_ENVIRONMENT:true,window:{matchMedia:()=>media},ResizeObserver:class{constructor(cb){this.cb=cb;observers.push(this);}observe(element){this.element=element;}disconnect(){this.closed=true;}}};
 for(const [key,value]of Object.entries(values)){previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 let renderer;
 t.after(async()=>{if(renderer)await act(async()=>renderer.unmount());for(const [key,d]of previous){if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];}});
 return {media,callbacks,observers,get renderer(){return renderer;},async mount(tree,createNodeMock){await act(async()=>{renderer=TestRenderer.create(tree,{createNodeMock});});return renderer;},async unmount(){await act(async()=>renderer.unmount());renderer=null;}};
}

test('the squish language switch changes language immediately, supports arrow keys and preserves an unsaved draft',async t=>{
 const p=platform(t),site={current:null},load=loader(site),{LanguageSwitcher}=load(path.join(root,'components/language-switcher.tsx'));
 let mounts=0;
 function Example(){const [language,setLanguage]=React.useState('en'),[draft,setDraft]=React.useState('');React.useEffect(()=>{mounts++;},[]);site.current={language,setLanguage,t:(en,vi)=>language==='vi'?vi:en};return React.createElement(React.Fragment,null,React.createElement(LanguageSwitcher),React.createElement('input',{value:draft,onChange:e=>setDraft(e.target.value)}),React.createElement('output',null,language==='vi'?'Tìm nhà':'Find a rental'));}
 const r=await p.mount(React.createElement(Example)),button=()=>r.root.findByType('button'),input=r.root.findByType('input');
 assert.equal(button().props.role,'switch');assert.equal(button().props['aria-checked'],false);
 await act(async()=>input.props.onChange({target:{value:'A home near work'}}));
 await act(async()=>button().props.onClick());assert.equal(button().props['aria-checked'],true);assert.equal(r.root.findByType('output').children.join(''),'Tìm nhà');assert.equal(r.root.findByType('input'),input);assert.equal(input.props.value,'A home near work');assert.equal(mounts,1);
 let prevented=false;await act(async()=>button().props.onKeyDown({key:'ArrowLeft',preventDefault(){prevented=true;}}));assert.equal(prevented,true);assert.equal(button().props['aria-checked'],false);assert.equal(input.props.value,'A home near work');
 await act(async()=>{p.media.matches=true;for(const cb of p.callbacks)cb();});assert.equal(button().props['data-reduced-motion'],true);assert.equal(button().props['data-squish-active'],false);
 await p.unmount();assert.equal(p.callbacks.size,0);
});

test('district cards render native links without a motion-provider dependency and clean up their observers',async t=>{
 const p=platform(t),load=loader({current:{}}),BounceCards=load(path.join(root,'components/react-bits/bounce-cards.tsx')).default;
 const cards=JSON.parse(fs.readFileSync(path.join(root,'data/site-content.json'),'utf8')).neighbourhoods.map(n=>({id:n.slug,href:'/homes?district='+n.slug,image:n.image,title:n.name,content:n.tagline_en}));
 const view=()=>React.createElement(BounceCards,{cards,label:'Hanoi districts'});
 const html=renderToString(view());for(const card of cards){assert.ok(html.includes('href="'+card.href+'"'));assert.ok(html.includes(card.title));}assert.ok(!html.includes('opacity:0'));assert.ok(!html.includes('scale(0)'));
 const listeners=new Map(),rootNode={style:{setProperty(){}},getBoundingClientRect:()=>({width:839,left:0,top:1200,height:320}),addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
 const r=await p.mount(view(),node=>node.type==='ul'?rootNode:null),list=()=>r.root.findByType('ul');
 assert.equal(list().props['data-reduced-motion'],false);assert.equal(r.root.findAllByType('li').length,cards.length);assert.equal(p.observers.length,1);
 assert.deepEqual(r.root.findAllByType('a').map(n=>n.props.href),cards.map(n=>n.href));assert.ok(listeners.has('pointermove'));assert.ok(!listeners.has('pointerenter'));
 await act(async()=>p.observers[0].cb([{contentRect:{width:900}}]));
 await act(async()=>{p.media.matches=true;for(const cb of [...p.callbacks])cb();});assert.equal(list().props['data-reduced-motion'],true);
 await p.unmount();assert.equal(p.callbacks.size,0);assert.ok(p.observers.every(o=>o.closed));assert.equal(listeners.size,0);
});

test('Vinhomes uses the supplied homes, original currency and local photos with no invented missing specifications',()=>{
 const load=loader({current:{}}),{vinhomesProjects,projectSummary,projectRent,enquiryContext}=load(path.join(root,'lib/vinhomes.ts'));
 assert.equal(vinhomesProjects.length,3);assert.equal(new Set(vinhomesProjects.map(p=>p.slug)).size,3);
 for(const project of vinhomesProjects){assert.ok(project.images.length>=7);assert.equal(new Set(project.images).size,project.images.length);for(const image of project.images)assert.ok(fs.existsSync(path.join(root,'public',image)),image);assert.ok(fs.existsSync(path.join(root,project.sourceNote)));assert.match(projectRent(project,'vi'),/₫/);}
 const smart=vinhomesProjects.find(p=>p.slug==='smart-city');assert.equal(smart.reference,'GH202');assert.equal(smart.areaSqm,undefined);assert.equal(smart.bathrooms,undefined);assert.equal(smart.leaseMonths,undefined);assert.equal(smart.rentVnd,10500000);assert.equal(projectSummary(smart,'vi'),'1+ phòng ngủ');assert.ok(smart.images.every(p=>!p.includes('1793001532444')));
 assert.equal(enquiryContext('restaurant',null,'en'),'Restaurant opening consultancy');assert.equal(enquiryContext('office',null,'vi'),'Tư vấn mở văn phòng');assert.equal(enquiryContext(null,'smart-city','en'),'Vinhomes Smart City · S403 · GH202');assert.equal(enquiryContext('<script>',null,'en'),'');
});

test('expanded district gallery pages four cards, preserves its page on translation and clamps after CMS removal',async t=>{
 const p=platform(t),site={current:null},load=loader(site),{DistrictGallery}=load(path.join(root,'components/district-gallery.tsx'));
 const content={...JSON.parse(fs.readFileSync(path.join(root,'data/site-content.json'),'utf8')),properties:JSON.parse(fs.readFileSync(path.join(root,'data/properties.json'),'utf8'))};
 let changeLanguage,changeContent;
 function Example(){const [language,setLanguage]=React.useState('en'),[current,setContent]=React.useState(content);changeLanguage=setLanguage;changeContent=setContent;site.current={language,content:current,t:(en,vi)=>language==='vi'?vi:en};return React.createElement(DistrictGallery);}
 const r=await p.mount(React.createElement(Example)),links=()=>r.root.findAllByType('a'),next=()=>r.root.findByProps({'aria-label':'Next areas'});
 assert.equal(links().length,4);assert.ok(links().some(a=>a.props.href==='/vinhomes'));assert.ok(links().find(a=>a.props.href==='/vinhomes').findByType('img').props.srcSet.includes('960w'));
 const control=next();await act(async()=>control.props.onClick());assert.equal(next(),control);assert.ok(links().some(a=>a.props.href==='/contact?area=cau-giay'));
 await act(async()=>next().props.onClick());assert.ok(links().some(a=>a.props.href==='/contact?area=ha-dong'));assert.equal(next().props.disabled,true);
 await act(async()=>changeLanguage('vi'));assert.match(r.root.findByProps({role:'status'}).children.join(''),/Khu vực 9–12/);assert.ok(links().some(a=>a.props.href==='/contact?area=ha-dong'));
 await act(async()=>changeContent({...content,neighbourhoods:content.neighbourhoods.slice(0,4)}));assert.equal(links().length,1);assert.match(r.root.findByProps({role:'status'}).children.join(''),/Khu vực 5–5/);
});
