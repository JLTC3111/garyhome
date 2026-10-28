import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from 'typescript';

const base=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(base,'package.json'));
function loadPlayer(state={language:'en'}){
 const modules=new Map();
 function load(file){
  if(modules.has(file))return modules.get(file).exports;
  const loaded={exports:{}};modules.set(file,loaded);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  function dependency(id){
   if(id==='./site-context')return {useSite:()=>({t:(en,vi)=>state.language==='vi'?vi:en})};
   if(id.startsWith('@/'))return load(path.join(base,id.slice(2)+'.ts'));
   return require(id);
  }
  vm.runInThisContext('(function(exports,require,module){'+code+'\n})',{filename:file})(loaded.exports,dependency,loaded);
  return loaded.exports;
 }
 return load(path.join(base,'components/portal-manual.tsx'));
}

async function player(t){
 const descriptors=new Map(),set=(key,value)=>{descriptors.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});};
 const doc=Object.assign(new EventTarget(),{fullscreenElement:null}),state={language:'en'};
 set('IS_REACT_ACT_ENVIRONMENT',true);set('document',doc);
 const {PortalVideoPlayer}=loadPlayer(state);let renderer,refreshes=0;
 const props={src:'https://private.example.invalid/manual?token=first',revision:1,title:'Gary Home website manual',refreshing:false,accessFailed:false,refresh:()=>refreshes++};
 const media={duration:233.215,currentTime:0,paused:true,ended:false,volume:1,muted:false,playbackRate:1,playCalls:0,pauseCalls:0,
  async play(){media.playCalls++;if(media.playError)throw media.playError;if(media.pendingPlay)return media.pendingPlay;media.paused=false;video().props.onPlay();},
  pause(){media.pauseCalls++;media.paused=true;video().props.onPause();}};
 const frame={async requestFullscreen(){doc.fullscreenElement=frame;doc.dispatchEvent(new Event('fullscreenchange'));}};
 doc.exitFullscreen=async()=>{doc.fullscreenElement=null;doc.dispatchEvent(new Event('fullscreenchange'));};
 const video=()=>renderer.root.findByType('video'),button=label=>renderer.root.findAllByType('button').find(node=>node.props['aria-label']===label||node.children.includes(label));
 const render=async next=>{Object.assign(props,next);await act(async()=>renderer.update(React.createElement(PortalVideoPlayer,props)));};
 await act(async()=>{renderer=TestRenderer.create(React.createElement(PortalVideoPlayer,props),{createNodeMock:element=>element.type==='video'?media:element.props.className==='manual-video-player'?frame:null});});
 t.after(async()=>{await act(async()=>renderer.unmount());for(const[key,descriptor]of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 const metadata=async()=>{await act(async()=>video().props.onLoadedMetadata({currentTarget:media}));};
 const click=async label=>{await act(async()=>{await button(label).props.onClick();});};
 return {renderer,media,state,props,doc,frame,video,button,render,metadata,click,get refreshes(){return refreshes;}};
}

test('manual timing handles unavailable durations and hour-long recordings',()=>{
 const {videoTime}=loadPlayer();assert.equal(videoTime(Infinity),'0:00');assert.equal(videoTime(-10),'0:00');assert.equal(videoTime(233.215),'3:53');assert.equal(videoTime(3601),'1:00:01');
});

test('manual playback is user initiated and custom controls reflect the media events',async t=>{
 const h=await player(t);assert.equal(h.video().props.preload,'metadata');assert.equal(h.video().props.playsInline,true);assert.equal(h.video().props.autoPlay,undefined);assert.equal(h.media.playCalls,0);
 await h.click('Play');assert.equal(h.media.playCalls,1);assert.ok(h.button('Pause'));
 await h.metadata();assert.match(JSON.stringify(h.renderer.toJSON()),/3:53/);assert.ok(h.button('Pause'));
 await h.click('Pause');assert.equal(h.media.pauseCalls,1);assert.ok(h.button('Play'));
 await act(async()=>h.video().props.onEnded());assert.ok(h.button('Play'));
});

test('manual timeline and keyboard seeking clamp to the recording and never hijack form controls',async t=>{
 const h=await player(t);await h.metadata();
 await h.click('Forward 10 seconds');assert.equal(h.media.currentTime,10);await h.click('Back 10 seconds');await h.click('Back 10 seconds');assert.equal(h.media.currentTime,0);
 const timeline=()=>h.renderer.root.findAllByType('input').find(node=>node.props.max===233.215);
 await act(async()=>timeline().props.onChange({target:{value:'999'}}));assert.equal(h.media.currentTime,233.215);
 let prevented=0;const keys=h.renderer.root.findByProps({className:'manual-video-player'}).props.onKeyDown;
 await act(async()=>keys({key:'ArrowLeft',target:{closest:()=>null},preventDefault(){prevented++;}}));assert.equal(h.media.currentTime,223.215);assert.equal(prevented,1);
 await act(async()=>keys({key:'ArrowLeft',target:{closest:()=>({tagName:'INPUT'})},preventDefault(){prevented++;}}));assert.equal(h.media.currentTime,223.215);assert.equal(prevented,1);
});

test('manual volume, playback rate and fullscreen controls update the actual player',async t=>{
 const h=await player(t);await h.metadata();
 await h.click('Mute');assert.equal(h.media.muted,true);await h.click('Unmute');assert.equal(h.media.muted,false);
 await act(async()=>h.renderer.root.findAllByType('input').find(node=>node.props.max===1).props.onChange({target:{value:'0'}}));assert.equal(h.media.volume,0);await h.click('Unmute');assert.equal(h.media.volume,1);assert.equal(h.media.muted,false);
 await h.click('Playback speed: 1×. Change speed');assert.equal(h.media.playbackRate,1.25);
 await h.click('Enter fullscreen');assert.equal(h.doc.fullscreenElement,h.frame);await h.click('Exit fullscreen');assert.equal(h.doc.fullscreenElement,null);
});

test('secure link refresh preserves the playhead and settings without autoplay or language resets',async t=>{
 const h=await player(t);await h.metadata();h.media.currentTime=81;await act(async()=>h.video().props.onTimeUpdate({currentTarget:h.media}));await h.click('Playback speed: 1×. Change speed');await h.click('Mute');
 await act(async()=>h.video().props.onError());await h.click('Reload video');assert.equal(h.refreshes,1);
 await h.render({src:'https://private.example.invalid/manual?token=renewed',revision:2});h.media.currentTime=0;await h.metadata();assert.equal(h.media.currentTime,81);assert.equal(h.media.playbackRate,1.25);assert.equal(h.media.muted,true);assert.equal(h.media.playCalls,0);
 h.state.language='vi';await h.render({});assert.equal(h.media.currentTime,81);assert.equal(h.video().props.src,'https://private.example.invalid/manual?token=renewed');assert.ok(h.button('Phát'));
});

test('a refused playback attempt is acknowledged and can be retried',async t=>{
 const h=await player(t);await h.metadata();h.media.playError=new Error('NotAllowedError');await h.click('Play');assert.match(JSON.stringify(h.renderer.toJSON()),/Playback didn’t start/);
 h.media.playError=null;await h.click('Play');assert.ok(h.button('Pause'));assert.doesNotMatch(JSON.stringify(h.renderer.toJSON()),/Playback didn’t start/);
});
