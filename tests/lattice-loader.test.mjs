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
function load(){const module={exports:{}};const file=path.join(root,'components/react-bits/lattice-loader.tsx');const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;vm.runInThisContext('(function(exports,require,module){'+source+'\n})',{filename:file})(module.exports,require,module);return module.exports.LatticeLoader;}

test('official Lattice orbit is visible in server markup with an accessible loading label and decorative cells',()=>{
 const Loader=load(),html=renderToStaticMarkup(React.createElement(Loader,{label:'Restoring your session…'}));
 assert.match(html,/role="status"/);assert.match(html,/aria-busy="true"/);assert.match(html,/Restoring your session…/);assert.match(html,/lattice-loader__grid" aria-hidden="true"/);
 assert.equal((html.match(/class="lattice-loader__cell"/g)||[]).length,18);assert.equal((html.match(/data-hole=""/g)||[]).length,1);assert.match(html,/--ll-cycle:864ms/);
});

test('translation updates the same loading indicator and completion/error states release busy status without JS polling',async t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let renderer;t.after(async()=>{if(renderer)await act(async()=>renderer.unmount());if(previous)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',previous);else delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
 const Loader=load();await act(async()=>{renderer=TestRenderer.create(React.createElement(Loader,{label:'Restoring your session…'}));});
 const host=renderer.root.findByProps({className:'lattice-loader'});assert.equal(host.props['aria-busy'],true);
 await act(async()=>renderer.update(React.createElement(Loader,{label:'Đang khôi phục phiên đăng nhập…'})));assert.equal(renderer.root.findByProps({className:'lattice-loader'}),host);assert.equal(renderer.root.findByProps({className:'lattice-loader__label'}).children.join(''),'Đang khôi phục phiên đăng nhập…');
 await act(async()=>renderer.update(React.createElement(Loader,{status:'error',errorLabel:'Reconnect to continue.'})));assert.equal(host.props['aria-busy'],false);assert.equal(host.props['data-status'],'error');assert.equal(renderer.root.findByProps({className:'lattice-loader__label'}).children.join(''),'Reconnect to continue.');
 await act(async()=>renderer.update(React.createElement(Loader,{status:'done',doneLabel:'Connected',announce:false})));assert.equal(host.props.role,undefined);assert.equal(host.props['aria-busy'],false);assert.equal(renderer.root.findByProps({className:'lattice-loader__label'}).children.join(''),'Connected');
});

test('reduced motion provides a static lattice and settled states pause cell animations',()=>{
 const css=fs.readFileSync(path.join(root,'app/lattice-loader.css'),'utf8');
 assert.match(css,/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*animation:none!important/);
 assert.match(css,/not\(\[data-status='working'\]\)[\s\S]*animation-play-state:\s*paused/);
 const Loader=load(),html=renderToStaticMarkup(React.createElement(Loader,{grid:4,pattern:'sweep',label:'Loading…'}));assert.equal((html.match(/class="lattice-loader__cell"/g)||[]).length,32);
});
