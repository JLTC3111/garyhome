import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import TestRenderer,{act} from 'react-test-renderer';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const sourceA='https://media.example/properties/a.jpg',sourceB='https://media.example/properties/b.jpg';
function photoRect(index,columns=3){
 const width=120,height=180,gap=12,column=index%columns,row=Math.floor(index/columns);
 const left=16+column*(width+gap),top=20+row*(height+gap);
 return {left,top,right:left+width,bottom:top+height,width,height};
}
function photoCenter(index,columns=3){
 const rect=photoRect(index,columns);
 return {x:(rect.left+rect.right)/2,y:(rect.top+rect.bottom)/2};
}
function loadGridExports(){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const loaded={exports:{}};cache.set(file,loaded);
  const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  function dependency(id){
   if(id==='./use-studio-text')return {useStudioText:()=>((message,values={})=>message.replace(/\{(\w+)\}/g,(_,key)=>String(values[key])))};
   if(id==='./site-context')return {useSite:()=>({t:en=>en,language:'en'})};
   if(id==='next/image')return {__esModule:true,default:props=>React.createElement('img',props)};
   if(id.startsWith('@/')||id.startsWith('.')){
    const base=id.startsWith('@/')?path.join(root,id.slice(2)):path.resolve(path.dirname(file),id);
    const resolved=[base,base+'.ts',base+'.tsx'].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());
    assert.ok(resolved,`Resolve ${id} from ${file}`);
    return load(resolved);
   }
   return require(id);
  }
  vm.runInThisContext('(function(exports,require,module){'+js+'\n})',{filename:file})(loaded.exports,dependency,loaded);
  return loaded.exports;
 }
 return load(path.join(root,'components/property-photo-grid.tsx'));
}
function loadGrid(){return loadGridExports().PropertyPhotoGrid;}

async function harness(t,props){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const Grid=loadGrid(),covers=[],removals=[],focused=[],removeTargets=new Map();let renderer;
 const document=new EventTarget();
 document.defaultView=new EventTarget();
 const removeBounds={left:20,top:20,right:60,bottom:60};
 const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
 const allProps={images:[sourceA,sourceB],makeCover:index=>covers.push(index),remove:index=>removals.push(index),...props};
 await act(async()=>{renderer=TestRenderer.create(React.createElement(Grid,allProps),{createNodeMock:node=>{
   if(node.type==='dialog')return dialog;
   if(node.props.className==='editor-photo-remove'){
    let capture;
    const target={ownerDocument:document,disabled:node.props.disabled,closest:()=>null,getBoundingClientRect:()=>removeBounds,
     focus(){document.activeElement=this;},setPointerCapture(id){capture=id;},hasPointerCapture:id=>capture===id,releasePointerCapture(){capture=undefined;}};
    removeTargets.set(node.props['aria-label'],target);
    return target;
   }
   if(node.props.className==='editor-photo-grid')return {
    focus:()=>focused.push('grid'),
    querySelector:selector=>({focus:()=>focused.push(selector)}),
    querySelectorAll(selector){
     if(selector!=='[data-photo-index]'||!renderer)return [];
     return renderer.root.findAllByType('figure').filter(figure=>figure.props['data-photo-index']!==undefined).map(figure=>{
      const index=figure.props['data-photo-index'];
      return {dataset:{photoIndex:String(index)},getBoundingClientRect:()=>photoRect(index)};
     });
    },
   };
   return null;
 }});});
 t.after(async()=>{await act(async()=>renderer.unmount());if(previous)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',previous);else delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
 return {renderer,covers,removals,dialog,focused,removeTargets,document,async update(next){await act(async()=>renderer.update(React.createElement(Grid,{...allProps,...next})));}};
}

test('photo captions contain the complete long, special and Unicode filename with its original extension',async t=>{
 const long='3-bedroom-apartment-'+('tay-ho-lake-view-pets-allowed-'.repeat(10))+'Ảnh đặc biệt * #1.JPG';
 const unicode='Căn hộ Tây Hồ – 3 phòng (Ảnh 1).JPEG';
 const h=await harness(t,{filenames:{[sourceA]:long,[sourceB]:unicode}});
 const captions=h.renderer.root.findAllByType('figcaption');
 assert.equal(captions[0].findAllByType('span')[1].children.join(''),long);
 assert.equal(captions[1].findAllByType('span')[1].children.join(''),unicode);
 assert.equal(captions[0].findAllByType('span')[0].children.join(''),'Original filename');
 assert.equal(captions[0].props.title,undefined,'the full name is visible text rather than tooltip-only');
 const css=fs.readFileSync(path.join(root,'app/rental.css'),'utf8'),rule=css.match(/\.editor-photo-filename\{([^}]+)\}/)?.[1];
 assert.ok(rule);assert.match(rule,/white-space:normal/);assert.match(rule,/overflow-wrap:anywhere/);assert.doesNotMatch(rule,/text-overflow|line-clamp/);
});

test('filenames render as escaped text rather than HTML',()=>{
 const Grid=loadGrid(),filename='3-bedroom-<img onerror=alert(1)>-&"\'-tay-ho.JPG';
 const html=renderToStaticMarkup(React.createElement(Grid,{images:[sourceA],filenames:{[sourceA]:filename},makeCover(){},remove(){}}));
 assert.match(html,/&lt;img onerror=alert\(1\)&gt;/);assert.match(html,/&amp;/);assert.doesNotMatch(html,/<img onerror=/);
 assert.match(html,/-tay-ho\.JPG/);
});

test('legacy URLs show their full decoded stored filename while unnamed inline images are explicit',async t=>{
 const source='https://media.example/3-bedroom-apartment-tay-ho-%2A-%2A-%2A.jpg?token=ignored';
 const h=await harness(t,{images:[source,'data:image/jpeg;base64,AAAA']});
 const names=h.renderer.root.findAllByType('figcaption').map(caption=>caption.findAllByType('span')[1].children.join(''));
 assert.deepEqual(names,['3-bedroom-apartment-tay-ho-*-*-*.jpg','Filename unavailable']);
 const captions=h.renderer.root.findAllByType('figcaption');assert.equal(captions[0].props['data-filename-source'],'stored');assert.equal(captions[0].findAllByType('span')[0].children.join(''),'Stored filename');
 assert.equal(captions[1].props['data-filename-source'],'unavailable');assert.match(h.renderer.root.findByProps({className:'small muted image-filename-note'}).children.join(''),/Original upload names were not recorded/);
});

test('a click offers inline confirmation without removing the photo, and saving disables the gallery controls',async t=>{
 const h=await harness(t,{}),buttons=()=>h.renderer.root.findAllByType('button');
 assert.equal(buttons().length,5);assert.ok(!buttons().some(button=>button.props['aria-label']?.startsWith('Set photo 1 as cover')));
 const setCover=buttons().find(button=>button.props['aria-label']?.startsWith('Set photo 2 as cover'));
 assert.match(setCover.props.title,/first position/);
 await act(async()=>setCover.props.onClick());
 const trash=()=>buttons().find(button=>button.props['aria-label']==='Remove photo 1');
 assert.equal(trash().props['data-button-size'],'icon');
 assert.match(trash().findAllByType('svg')[0].props.className,/lucide-trash-2/);
 const dialogs=h.renderer.root.findAllByType('dialog').length;
 await act(async()=>trash().props.onClick({detail:1}));
 await act(async()=>trash().props.onClick({detail:1}));
 assert.deepEqual(h.removals,[]);
 assert.equal(trash().props['aria-expanded'],true);
 assert.equal(h.renderer.root.findAllByType('dialog').length,dialogs);
 await act(async()=>buttons().find(button=>button.props['aria-label']==='Confirm removal of photo 1').props.onClick());
 assert.deepEqual(h.covers,[1]);assert.deepEqual(h.removals,[0]);
 await h.update({disabled:true});assert.ok(buttons().every(button=>button.props.disabled===true));
 assert.equal(h.renderer.root.findAllByProps({className:'editor-photo-order'})[0].children.join(''),'COVER');
});

function holdClock(t){
 let now=0;
 t.mock.timers.enable({apis:['setTimeout']});
 t.mock.method(performance,'now',()=>now);
 return async ms=>{now+=ms;await act(async()=>t.mock.timers.tick(ms));};
}

test('pointer holds require two full seconds and cancel on early release, drift or loss of capture',async t=>{
 const advance=holdClock(t),removed=[];
 const h=await harness(t,{remove:(index,src)=>removed.push([index,src])});
 const name='Remove photo 2',button=()=>h.renderer.root.findByProps({'aria-label':name});
 const send=async (handler,values={})=>await act(async()=>button().props[handler]({
  button:0,buttons:1,isPrimary:true,pointerId:7,pointerType:'mouse',clientX:40,clientY:40,detail:1,currentTarget:h.removeTargets.get(name),...values,
 }));
 await send('onPointerDown');
 assert.equal(button().props['data-holding'],true);
 await advance(1999);
 assert.deepEqual(removed,[]);
 await send('onPointerUp');
 await send('onClick');
 await advance(1);
 assert.deepEqual(removed,[]);
 assert.equal(button().props['aria-expanded'],false);

 for(const [handler,values] of [['onPointerMove',{clientX:61}],['onLostPointerCapture',{}],['onPointerCancel',{}]]){
  await send('onPointerDown',{pointerType:'touch'});
  await advance(1000);
  await send(handler,values);
  await advance(1000);
  assert.deepEqual(removed,[]);
 }

 await send('onPointerDown',{pointerType:'touch'});
 await advance(1999);
 assert.deepEqual(removed,[]);
 await advance(1);
 await send('onPointerUp');
 await send('onClick');
 assert.deepEqual(removed,[[1,sourceB]]);
 assert.equal(button().props['aria-expanded'],false);
});

test('keyboard holds ignore repeat and cancel on blur, Escape or a listing save',async t=>{
 const advance=holdClock(t),h=await harness(t,{});
 const name='Remove photo 1',button=()=>h.renderer.root.findByProps({'aria-label':name});
 const key=(value,repeat=false)=>({key:value,repeat,preventDefault(){},stopPropagation(){}});
 await act(async()=>button().props.onKeyDown(key(' ')));
 await advance(1000);
 await act(async()=>button().props.onKeyDown(key('Escape')));
 await advance(1000);
 await act(async()=>button().props.onKeyDown(key('Enter')));
 await act(async()=>h.document.defaultView.dispatchEvent(new Event('blur')));
 await advance(2000);
 await act(async()=>button().props.onKeyDown(key('Enter')));
 await h.update({disabled:true});
 await advance(2000);
 assert.deepEqual(h.removals,[]);

 await h.update({disabled:false});
 await act(async()=>button().props.onKeyDown(key('Enter')));
 await act(async()=>button().props.onKeyUp(key('Enter')));
 assert.equal(button().props['aria-expanded'],true);
 const cancel=h.renderer.root.findAllByType('button').find(node=>node.children.join('')==='Cancel');
 await act(async()=>cancel.props.onClick());
 assert.equal(button().props['aria-expanded'],false);
 await act(async()=>button().props.onClick({detail:0}));
 assert.equal(button().props['aria-expanded'],true);
 const confirmation=h.renderer.root.findByProps({className:'editor-photo-remove-confirmation'});
 await act(async()=>confirmation.props.onKeyDown(key('Escape')));

 await act(async()=>button().props.onKeyDown(key('Enter')));
 await advance(1000);
 await act(async()=>button().props.onKeyDown(key('Enter',true)));
 await advance(1000);
 assert.deepEqual(h.removals,[0]);
 await h.update({images:[sourceB]});
 assert.deepEqual(h.focused,['[data-photo-index="0"]']);
});

test('Eye opens the actual clicked image without editing and Escape keeps the drawer open',async t=>{
 const operations=[];
 const h=await harness(t,{metadata:{[sourceB]:{description_en:'Balcony caption'}},onMetadataChange:()=>operations.push('metadata'),move:()=>operations.push('move')});
 const btn=label=>h.renderer.root.findByProps({'aria-label':label});
 const opener={focus(options){operations.push(options);}};
 assert.equal(btn('Edit photo 1').props['aria-pressed'],true);
 await act(async()=>btn('Preview photo 2').props.onClick({currentTarget:opener}));
 assert.equal(h.dialog.open,true);
 assert.equal(h.renderer.root.findByProps({className:'rental-lightbox-stage'}).findByType('img').props.src,sourceB);
 assert.match(h.renderer.root.findByProps({className:'rental-lightbox-caption'}).findByType('p').props.children,/Balcony caption/);
 const modal=h.renderer.root.findByType('dialog');
 await act(async()=>modal.props.onKeyDown({key:'ArrowRight',preventDefault(){},stopPropagation(){}}));
 assert.equal(h.renderer.root.findByProps({className:'rental-lightbox-stage'}).findByType('img').props.src,sourceA);
 let stopped=false;
 await act(async()=>modal.props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){stopped=true;}}));
 assert.equal(stopped,true);assert.equal(h.dialog.open,false);
 assert.deepEqual(operations,[{preventScroll:true}]);
 assert.deepEqual(h.covers,[]);assert.deepEqual(h.removals,[]);
 assert.equal(btn('Edit photo 1').props['aria-pressed'],true);
});

function pointerEvent(values={}){
 const target={setPointerCapture(){},releasePointerCapture(){},hasPointerCapture(){return true;}};
 return {button:0,pointerId:1,currentTarget:target,preventDefault(){},stopPropagation(){},...values};
}
function at(point,extra={}){return pointerEvent({clientX:point.x,clientY:point.y,...extra});}

test('drag and keyboard reordering move any photo, including into the cover position, and return keyboard focus',async t=>{
 const sourceC='https://media.example/properties/c.jpg',moves=[];
 const h=await harness(t,{images:[sourceA,sourceB,sourceC],move:(from,to)=>moves.push([from,to])});
 const handle=position=>h.renderer.root.findByProps({'aria-label':`Reorder photo ${position}`});
 const card=index=>h.renderer.root.findByProps({'data-photo-index':index});
 const keyboardEvent=key=>({key,preventDefault(){},stopPropagation(){}});
 assert.equal(handle(1).props.onClick,undefined);
 assert.equal(handle(1).props['data-button-variant'],'reorder');
 assert.equal(h.renderer.root.findByProps({'aria-label':'Preview photo 1'}).props['data-button-variant'],'view');
 assert.equal(h.renderer.root.findByProps({'aria-label':'Set photo 2 as cover (move to first position)'}).props['data-button-variant'],'feature');
 assert.equal(h.renderer.root.findByProps({'aria-label':'Remove photo 1'}).props['data-button-variant'],'danger');
 assert.equal(handle(1).props['aria-controls'],undefined);
 assert.equal(handle(1).props.draggable,false);
 assert.equal(handle(1).props.style.touchAction,'none');
 assert.equal(handle(1).props.title,'Drag or use the Up and Down arrow keys to reorder. Position 1 is the cover photo.');
 assert.equal(card(0).props.onDrop,undefined);
 await act(async()=>handle(2).props.onKeyDown(keyboardEvent('ArrowUp')));
 assert.deepEqual(moves,[[1,0]]);
 await h.update({images:[sourceB,sourceA,sourceC]});
 assert.deepEqual(h.focused,['[data-photo-index="0"] [data-photo-control="reorder"]']);
 assert.match(h.renderer.root.findByProps({className:'sr-only editor-photo-order-status'}).props.children,/position 1 of 3/);
 assert.match(h.renderer.root.findByProps({className:'sr-only editor-photo-order-status'}).props.children,/cover photo/);
 assert.equal(h.renderer.root.findAllByProps({className:'editor-photo-order'})[0].children.join(''),'COVER');
 assert.equal(h.renderer.root.findAllByProps({className:'editor-photo-preview'})[0].findByType('img').props.src,sourceB);
 await act(async()=>handle(1).props.onKeyDown(keyboardEvent('ArrowDown')));
 assert.deepEqual(moves,[[1,0],[0,1]]);
 assert.match(h.renderer.root.findByProps({className:'sr-only editor-photo-order-status'}).props.children,/Position 1 is now the cover photo/);
 const origin=photoCenter(2),target=photoCenter(1);
 await act(async()=>handle(3).props.onPointerDown(at(origin)));
 await act(async()=>handle(3).props.onPointerMove(at({x:origin.x+8,y:origin.y})));
 await act(async()=>handle(3).props.onPointerMove(at(target)));
 assert.equal(card(1).props['data-photo-drop-target'],'true');
 assert.equal(card(1).findAllByProps({'data-photo-drop-indicator':'true'}).length,1);
 assert.equal(card(2).props['data-photo-dragging'],'true');
 await act(async()=>handle(3).props.onPointerUp(at(target)));
 assert.equal(card(1).props['data-photo-drop-target'],undefined);
 assert.deepEqual(moves,[[1,0],[0,1],[2,1]]);
});

test('photo 19 can move earlier, between rows, and to position 1 without changing selection or file identity',async t=>{
 const {nearestPhotoIndex}=loadGridExports();
 const cards=columns=>Array.from({length:19},(_,index)=>({index,...photoRect(index,columns)}));
 const nineteen=cards(3);
 const center=index=>photoCenter(index);
 assert.equal(nearestPhotoIndex(center(4),nineteen,18),4);
 const first=photoRect(0),nextRow=photoRect(3);
 assert.equal(nearestPhotoIndex({x:(first.left+first.right)/2,y:(first.bottom+nextRow.top)/2},nineteen,18),3);
 assert.equal(nearestPhotoIndex(center(0),nineteen,18),0);
 assert.equal(nearestPhotoIndex(center(18),nineteen,18),null);
 const narrow=cards(2),top=photoRect(0,2),below=photoRect(2,2);
 assert.equal(nearestPhotoIndex({x:(top.left+top.right)/2,y:(top.bottom+below.top)/2},narrow,18),2);

 const sources=Array.from({length:19},(_,index)=>`https://media.example/storage/v1/object/public/property-media/properties/reorder/room-${String(index+1).padStart(2,'0')}.jpg`);
 const filenames=Object.fromEntries(sources.map((src,index)=>[src,`Room ${index+1}.JPG`]));
 let metadata={[sources[18]]:{description_en:'Unsaved balcony caption',alt_vi:'Ban công'}};
 let images=sources.slice();
 const moves=[];
 const h=await harness(t,{images,filenames,metadata,move:(from,to)=>moves.push([from,to]),onMetadataChange(src,patch){metadata={...metadata,[src]:{...metadata[src],...patch}};}});
 const handle=position=>h.renderer.root.findByProps({'aria-label':`Reorder photo ${position}`});
 const pressed=position=>h.renderer.root.findByProps({'aria-label':`Edit photo ${position}`}).props['aria-pressed'];
 const orderOf=src=>h.renderer.root.findAllByType('figure').find(figure=>figure.findByType('img').props.src===src).findByProps({className:'editor-photo-order'}).children.join('');
 const storedName=src=>h.renderer.root.findAllByType('figure').find(figure=>figure.findByType('img').props.src===src).findByType('figcaption').findAllByType('span')[1].children.join('');
 async function commit(){
  const [from,to]=moves.at(-1);
  const next=images.slice();
  const [item]=next.splice(from,1);
  next.splice(to,0,item);
  images=next;
  await h.update({images,metadata,filenames});
 }
 assert.equal(pressed(1),true);
 await act(async()=>h.renderer.root.findByProps({'aria-label':'Edit photo 19'}).props.onClick());
 const caption=()=>h.renderer.root.findByProps({className:'editor-photo-panel'}).findAllByType('textarea')[0];
 await act(async()=>caption().props.onChange({target:{value:'Unsaved balcony caption'}}));
 await h.update({metadata});
 await act(async()=>h.renderer.root.findByProps({'aria-label':'Edit photo 1'}).props.onClick());
 assert.equal(pressed(1),true);
 await act(async()=>handle(5).props.onPointerDown(at(photoCenter(4))));
 await act(async()=>handle(5).props.onPointerUp(at(photoCenter(4))));
 assert.equal(pressed(1),true);
 assert.deepEqual(moves,[]);

 const listeners=[];
 const body={style:{userSelect:'text'},dataset:{}};
 const previousDocument=globalThis.document,previousWindow=globalThis.window;
 globalThis.document={body};
 globalThis.window={addEventListener(type,listener,options){listeners.push({type,listener,options});},removeEventListener(){}};
 try{
  const start=photoCenter(18);
  await act(async()=>handle(19).props.onPointerDown(at(start)));
  await act(async()=>handle(19).props.onPointerMove(at({x:start.x+8,y:start.y})));
  assert.equal(body.style.userSelect,'none');
  assert.equal(body.dataset.photoReordering,'true');
  assert.ok(listeners.some(item=>item.type==='wheel'&&item.options.passive===false&&item.options.capture===true));
  assert.ok(listeners.some(item=>item.type==='touchmove'&&item.options.passive===false&&item.options.capture===true));
  assert.equal(h.renderer.root.findByProps({className:'editor-photo-grid'}).props['data-photo-reordering'],'true');
  assert.equal(pressed(1),true);
  const earlier=photoCenter(4);
  await act(async()=>handle(19).props.onPointerMove(at(earlier)));
  assert.equal(h.renderer.root.findByProps({'data-photo-index':4}).props['data-photo-drop-target'],'true');
  await act(async()=>handle(19).props.onPointerUp(at(earlier)));
  assert.deepEqual(moves.at(-1),[18,4]);
  await commit();
  assert.equal(orderOf(sources[18]),'5');
  assert.equal(storedName(sources[18]),'room-19.jpg');
  assert.equal(pressed(1),true);

  const upper=photoRect(0),lower=photoRect(3);
  const gap={x:(upper.left+upper.right)/2,y:(upper.bottom+lower.top)/2};
  const reorderFifth=()=>h.renderer.root.findByProps({'aria-label':'Reorder photo 5'});
  await act(async()=>reorderFifth().props.onPointerDown(at(photoCenter(4))));
  await act(async()=>reorderFifth().props.onPointerMove(at({x:gap.x+8,y:gap.y})));
  await act(async()=>reorderFifth().props.onPointerMove(at(gap)));
  assert.equal(h.renderer.root.findByProps({'data-photo-index':3}).props['data-photo-drop-target'],'true');
  await act(async()=>reorderFifth().props.onPointerUp(at(gap)));
  assert.deepEqual(moves.at(-1),[4,3]);
  await commit();
  assert.equal(orderOf(sources[18]),'4');
  assert.equal(orderOf(sources[0]),'COVER');
  assert.equal(pressed(1),true);

  const cover=photoCenter(0);
  const reorderFourth=()=>h.renderer.root.findByProps({'aria-label':'Reorder photo 4'});
  await act(async()=>reorderFourth().props.onPointerDown(at(photoCenter(3))));
  await act(async()=>reorderFourth().props.onPointerMove(at({x:cover.x,y:cover.y+8})));
  await act(async()=>reorderFourth().props.onPointerMove(at(cover)));
  assert.equal(h.renderer.root.findByProps({'data-photo-index':0}).props['data-photo-drop-target'],'true');
  assert.match(h.renderer.root.findByProps({className:'sr-only editor-photo-order-status'}).props.children,/position 1 of 19/);
  await act(async()=>reorderFourth().props.onPointerUp(at(cover)));
  assert.deepEqual(moves.at(-1),[3,0]);
  await commit();
 }finally{
  if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
  if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
 }
 assert.equal(orderOf(sources[18]),'COVER');
 assert.equal(orderOf(sources[0]),'2');
 assert.equal(storedName(sources[18]),'room-19.jpg');
 assert.equal(storedName(sources[0]),'room-01.jpg');
 assert.match(h.renderer.root.findAllByType('figure').find(figure=>figure.findByType('img').props.src===sources[18]).findByType('small').children.join(''),/Room 19\.JPG/);
 assert.equal(pressed(2),true);
 await act(async()=>h.renderer.root.findByProps({'aria-label':'Edit photo 1'}).props.onClick());
 assert.equal(h.renderer.root.findByProps({className:'editor-photo-panel'}).findAllByType('textarea')[0].props.value,'Unsaved balcony caption');
 assert.equal(h.renderer.root.findByProps({className:'editor-photo-panel'}).findAllByType('textarea')[3].props.value,'Ban công');
 assert.equal(h.renderer.root.findByProps({className:'editor-photo-panel'}).findByType('img').props.src,sources[18]);
 assert.deepEqual(Object.keys(filenames),sources);
 assert.equal(filenames[sources[18]],'Room 19.JPG');
});

test('photo action variants keep their own hover ink and do not inherit the Studio button fill',()=>{
 const actions=fs.readFileSync(path.join(root,'app/action-buttons.css'),'utf8');
 const studio=fs.readFileSync(path.join(root,'app/studio-theme.css'),'utf8');
 const drawer=fs.readFileSync(path.join(root,'app/editor-drawer.css'),'utf8');
 const globals=fs.readFileSync(path.join(root,'app/globals.css'),'utf8');
 assert.match(actions,/\[data-button-variant="feature"\]\s*\{[^}]*--action-hover:\s*var\(--action-feature-hover\)/);
 assert.match(actions,/\[data-button-variant="feature"\]\s*\{[^}]*--action-hover-ink:\s*var\(--action-feature-hover-ink\)/);
 assert.match(actions,/\[data-button-variant="reorder"\]\s*\{[^}]*--action-hover:\s*var\(--action-reorder-hover\)/);
 assert.match(actions,/\[data-button-variant="reorder"\]\s*\{[^}]*--action-hover-ink:\s*var\(--action-reorder-hover-ink\)/);
 assert.match(actions,/html\[data-home-theme="dark"\]\s*\{[^}]*--action-feature-hover:\s*#fbbf24;/);
 assert.match(actions,/html\[data-home-theme="dark"\]\s*\{[^}]*--action-feature-hover-ink:\s*#422006;/);
 assert.match(actions,/html\[data-home-theme="dark"\]\s*\{[^}]*--action-reorder-hover:\s*#60a5fa;/);
 assert.match(actions,/html\[data-home-theme="dark"\]\s*\{[^}]*--action-reorder-hover-ink:\s*#0f172a;/);
 assert.match(actions,/\[data-button-variant="reorder"\]\s*\{\s*touch-action:\s*none;/);
 assert.doesNotMatch(actions,/touch-action:\s*manipulation\s*!important/);
 assert.match(studio,/\.editor-photo-grid button:not\(\[data-button-variant\]\)/);
 assert.match(studio,/\.editor-photo-grid button:not\(\[data-button-variant\]\):hover/);
 assert.match(drawer,/\.editor-photo-grid button:not\(\[data-button-variant\]\):focus-visible/);
 assert.match(drawer,/\.editor-photo-remove\[data-button-variant="danger"\]\s*\{[^}]*--action-hover:\s*var\(--action-red\)/);
 assert.match(drawer,/\.editor-photo-remove\[data-button-variant="danger"\]\s*\{[^}]*--action-hover-ink:\s*var\(--action-white\)/);
 assert.match(drawer,/\.editor-photo-remove\[data-holding\]\s*\{[^}]*--action-state-ink:\s*var\(--action-white\)/);
 assert.match(globals,/\.editor-photo-grid button:not\(\[data-button-variant\]\)\{/);
 assert.doesNotMatch(globals,/\.editor-photo-grid button\{display:flex/);
 assert.doesNotMatch(drawer,/\.editor-photo-rename-trigger\s*\{[^}]*(?:background|border|padding)\s*:/);
});

test('reorder handle blocks scrolling and selection while a photo is dragged',()=>{
 const css=fs.readFileSync(path.join(root,'app/rental.css'),'utf8');
 assert.match(css,/\[data-photo-control="reorder"\]\{[^}]*touch-action:none/);
 assert.match(css,/\[data-photo-control="reorder"\]\{[^}]*user-select:none/);
 assert.match(css,/\[data-photo-reordering="true"\]\{[^}]*touch-action:none/);
 assert.match(css,/\[data-photo-reordering="true"\]\{[^}]*user-select:none/);
 assert.match(css,/\.editor-photo-drop-indicator\{[^}]*width:4px/);
 assert.match(css,/data-photo-drop-target="true"\]\{[^}]*outline:3px/);
});

test('existing UUID uploads show the complete stored basename and extension without inventing an original name',async t=>{
 const filename='045efb4c-c106-45d6-866c-460b52874c48.JPG',url='https://media.example/properties/'+filename;
 const h=await harness(t,{images:[url]});const caption=h.renderer.root.findByType('figcaption');
 assert.equal(caption.findAllByType('span')[1].children.join(''),filename);assert.equal(caption.props['data-filename-source'],'stored');
 await h.update({images:[url],filenames:{[url]:'3-bedroom-apartment-tay-ho-lake-view-001.JPG'}});
 assert.equal(h.renderer.root.findByType('figcaption').props['data-filename-source'],'original');
 assert.equal(h.renderer.root.findAllByProps({className:'small muted image-filename-note'}).length,0);
});

test('one photo editor opens by default and retains independent edits across selection and reordering',async t=>{
 let metadata={[sourceA]:{description_en:'First caption',description_vi:'Chú thích đầu',alt_en:'First alt'},
  [sourceB]:{description_en:'Second caption',alt_vi:'Ảnh sau'}};
 const filenames={[sourceA]:'Living room.JPG',[sourceB]:'Balcony.JPG'};
 const h=await harness(t,{filenames,metadata,
  onMetadataChange:(src,patch)=>{metadata={...metadata,[src]:{...metadata[src],...patch}};}});
 const panel=()=>h.renderer.root.findByProps({className:'editor-photo-panel'});
 const values=()=>panel().findAllByType('textarea').map(field=>field.props.value);
 const button=label=>h.renderer.root.findByProps({'aria-label':label});
 assert.equal(h.renderer.root.findAllByType('details').length,0);
 assert.equal(button('Edit photo 1').props['aria-pressed'],true);
 assert.deepEqual(values(),['First caption','Chú thích đầu','First alt','']);
 const newValue={target:{value:'Ảnh phòng khách'}};
 await act(async()=>panel().findAllByType('textarea')[3].props.onChange(newValue));
 await act(async()=>panel().findByType('input').props.onChange({target:{checked:true}}));
 await h.update({metadata});
 await act(async()=>button('Edit photo 2').props.onClick());
 assert.deepEqual(values(),['Second caption','','','Ảnh sau']);
 assert.equal(panel().findByType('input').props.checked,false);
 await act(async()=>button('Edit photo 1').props.onClick());
 assert.deepEqual(values(),['First caption','Chú thích đầu','First alt','Ảnh phòng khách']);
 assert.equal(panel().findByType('input').props.checked,true);
 await act(async()=>button('Set photo 2 as cover (move to first position)').props.onClick());
 assert.deepEqual(h.covers,[1]);
 await h.update({images:[sourceB,sourceA],metadata});
 assert.equal(button('Edit photo 2').props['aria-pressed'],true);
 assert.equal(panel().findByType('img').props.src,sourceA);
 assert.equal(values()[3],'Ảnh phòng khách');
 await h.update({images:[sourceB,'https://media.example/properties/replacement.jpg'],metadata});
 assert.equal(values()[0],'Second caption');
 await act(async()=>button('Edit photo 2').props.onClick());
 assert.deepEqual(values(),['','','','']);
});

test('photo editor uses a width-gated field grid and draws a single thumbnail focus ring',()=>{
 const css=fs.readFileSync(path.join(root,'app/editor-drawer.css'),'utf8');
 assert.match(css,/\.editor-photo-fields\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/@container listing-photo \(min-width:520px\)\s*\{\s*\.editor-photo-fields\s*\{[^}]*repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/\.editor-photo-filename-option\s*\{[^}]*grid-template-columns:auto minmax\(0,1fr\)/);
 assert.match(css,/\.editor-photo-card:has\(\.editor-photo-select:focus-visible\)\s*\{[^}]*outline:2px[^}]*outline-offset:2px[^}]*box-shadow:none/);
 assert.match(css,/\.editor-photo-select:focus-visible\s*\{\s*outline:none/);
});

test('a saved Storage photo exposes an inline rename and a read-only normalized preview',async t=>{
 const saved='https://media.example/storage/v1/object/public/property-media/properties/room.jpg%20(3).jpg', calls=[];
 const request={savedImages:[saved],history:async()=>[],retire:async()=>{},run:async(source,name)=>{
  calls.push([source,name]);
  return 'https://media.example/storage/v1/object/public/property-media/properties/renamed/room-03.jpg';
 }};
 const h=await harness(t,{images:[saved,sourceB],onMetadataChange(){},rename:request});
 assert.equal(h.renderer.root.findByProps({'aria-label':'Rename photo 1'}).props['data-button-variant'],'edit');
 assert.equal(h.renderer.root.findAllByProps({'aria-label':'Rename photo 2'}).length,0);
 assert.equal(h.renderer.root.findAllByProps({className:'editor-photo-rename'}).length,0);
 await act(async()=>h.renderer.root.findByProps({'aria-label':'Rename photo 1'}).props.onClick());
 const form=()=>h.renderer.root.findByProps({className:'editor-photo-rename'});
 assert.equal(form().findByType('input').props.value,'room-03.jpg');
 assert.deepEqual(calls,[],'opening the preview performs no Storage action');
 await act(async()=>form().findAllByType('button').find(button=>button.children.join('')==='Rename and remove old copy').props.onClick());
 assert.deepEqual(calls,[[saved,'room-03.jpg']]);
});

test('a reopened editor displays the saved Storage basename separately from the historical upload name',async t=>{
 const renamed='https://media.example/storage/v1/object/public/property-media/properties/renamed/room-03.jpg';
 const original='Room.jpg (3).jpg';
 const h=await harness(t,{images:[renamed],filenames:{[renamed]:original},
  metadata:{[renamed]:{description_vi:'Phòng khách',public_filename:original}},onMetadataChange(){}});
 const caption=h.renderer.root.findByType('figcaption');
 assert.deepEqual(caption.findAllByType('span').map(span=>span.children.join('')),['Current Storage filename','room-03.jpg']);
 assert.equal(caption.findByType('small').children.join(''),'Original upload filename · '+original);
 const panel=h.renderer.root.findByProps({className:'editor-photo-panel'});
 assert.equal(panel.findByType('img').props.src,renamed);
 assert.equal(panel.findAllByType('textarea')[1].props.value,'Phòng khách');
 assert.equal(panel.findByType('input').props.checked,true);
});
