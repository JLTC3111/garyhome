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
 const Loader=load(),html=renderToStaticMarkup(React.createElement(Loader,{label:'Loading listings…'}));
 assert.match(html,/role="status"/);assert.match(html,/aria-busy="true"/);assert.match(html,/Loading listings…/);assert.match(html,/lattice-loader__grid" aria-hidden="true"/);
 assert.match(html,/data-pattern="orbit"/);assert.match(html,/data-grid="3"/);assert.doesNotMatch(html,/--ll-color|--ll-mark/);
 assert.equal((html.match(/class="lattice-loader__cell"/g)||[]).length,18);assert.equal((html.match(/data-hole=""/g)||[]).length,1);assert.match(html,/--ll-cycle:864ms/);
});

test('Dots and the four-by-four Ripple keep their distinct staggering and original cycle timing',()=>{
 const Loader=load();
 const dots=renderToStaticMarkup(React.createElement(Loader,{pattern:'dots',grid:3}));
 const ripple=renderToStaticMarkup(React.createElement(Loader,{pattern:'ripple',grid:4}));
 const delays=html=>Array.from(html.matchAll(/animation-delay:(\d+)ms/g),match=>Number(match[1]));
 assert.match(dots,/--ll-n:3;/);assert.match(dots,/--ll-cycle:648ms/);
 assert.deepEqual(delays(dots),[0,216,432,0,216,432,0,216,432]);
 assert.match(ripple,/--ll-n:4;/);assert.match(ripple,/--ll-cycle:648ms/);
 assert.deepEqual(delays(ripple),[270,135,135,270,135,0,0,135,135,0,0,135,270,135,135,270]);
});

test('translation updates the same loading indicator and completion/error states release busy status without JS polling',async t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let renderer;t.after(async()=>{if(renderer)await act(async()=>renderer.unmount());if(previous)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',previous);else delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
 const Loader=load();await act(async()=>{renderer=TestRenderer.create(React.createElement(Loader,{label:'Connecting securely…'}));});
 const host=renderer.root.findByProps({className:'lattice-loader'});assert.equal(host.props['aria-busy'],true);
 await act(async()=>renderer.update(React.createElement(Loader,{label:'Đang kết nối an toàn…'})));assert.equal(renderer.root.findByProps({className:'lattice-loader'}),host);assert.equal(renderer.root.findByProps({className:'lattice-loader__label'}).children.join(''),'Đang kết nối an toàn…');
 await act(async()=>renderer.update(React.createElement(Loader,{status:'error',errorLabel:'Reconnect to continue.'})));assert.equal(host.props['aria-busy'],false);assert.equal(host.props['data-status'],'error');assert.equal(renderer.root.findByProps({className:'lattice-loader__label'}).children.join(''),'Reconnect to continue.');
 await act(async()=>renderer.update(React.createElement(Loader,{status:'done',doneLabel:'Connected',announce:false})));assert.equal(host.props.role,undefined);assert.equal(host.props['aria-busy'],false);assert.equal(renderer.root.findByProps({className:'lattice-loader__label'}).children.join(''),'Connected');
});

test('reduced motion provides a static lattice and settled states pause cell animations',()=>{
 const css=fs.readFileSync(path.join(root,'app/lattice-loader.css'),'utf8');
 assert.match(fs.readFileSync(path.join(root,'app/layout.tsx'),'utf8'),/import "\.\/lattice-loader\.css";/);
 assert.match(css,/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*animation:none!important/);
 assert.match(css,/--ll-color:\s*#111111/);assert.match(css,/--ll-color:\s*#ffffff/);
 assert.doesNotMatch(css,/#22c55e|#ef4444|gradient|lavender|cyan/i);
 assert.match(css,/not\(\[data-status='working'\]\)[\s\S]*animation-play-state:\s*paused/);
 const Loader=load(),html=renderToStaticMarkup(React.createElement(Loader,{grid:4,pattern:'sweep',label:'Loading…'}));assert.equal((html.match(/class="lattice-loader__cell"/g)||[]).length,32);
});
