import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { renderToString } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInThisContext('(function(exports,require,module){' + code + '\n})', { filename: file })(
    module.exports,
    id => id.startsWith('.') ? load(path.resolve(path.dirname(file), id + '.ts')) : require(id),
    module,
  );
  return module.exports;
}
const TechText = load(new URL('../components/react-bits/tech-text.tsx', import.meta.url).pathname).default;

function events() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    emit(type, event = {}) { for (const callback of listeners.get(type) || []) callback({ type, ...event }); },
    count() { return [...listeners.values()].reduce((total, set) => total + set.size, 0); },
  };
}

function environment(t, { reduced = false, canvasSupport = true } = {}) {
  const frames = new Map();
  let nextFrame = 0;
  let now = performance.now();
  const painted = [];
  const observers = { resize: [], intersection: [], theme: [] };
  const motion = { ...events(), matches: reduced };
  const scheme = { ...events(), matches: false };
  const browser = { ...events(), devicePixelRatio: 2, matchMedia: query => query.includes('reduced-motion') ? motion : scheme };
  const pendingFonts = [];
  const document = {
    ...events(), visibilityState: 'visible', documentElement: {}, body: {},
    fonts: { ready: new Promise(resolve => pendingFonts.push(resolve)), load: () => new Promise(resolve => pendingFonts.push(resolve)) },
    createElement(type) { assert.equal(type, 'canvas'); return { getContext: () => context(), width: 0, height: 0 }; },
  };
  let drawFailure = false;
  function context() {
    const target = {
      clearRect() { if (drawFailure) throw new Error('Canvas renderer unavailable'); },
      font: '600 86px Newsreader', letterSpacing: '0px',
      measureText(text) {
        const size = Number(this.font.match(/([\d.]+)px/)?.[1] || 86);
        return { width: [...text].length * size * .4, actualBoundingBoxLeft: 0, actualBoundingBoxRight: [...text].length * size * .4,
          actualBoundingBoxAscent: size * .7, actualBoundingBoxDescent: size * .15, fontBoundingBoxAscent: size * .9, fontBoundingBoxDescent: size * .2 };
      },
      fillText(text) { painted.push(text); },
      createRadialGradient() { return { addColorStop() {} }; },
      getImageData() { return { data: new Uint8ClampedArray(0) }; },
    };
    return new Proxy(target, { get(object, key) { return key in object ? object[key] : (...args) => {
      for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${String(key)} received a finite coordinate`);
    }; } });
  }
  const container = { ...events(), clientWidth: 480, clientHeight: 90, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, right: 480, bottom: 90 }) };
  const canvas = {
    ...events(),
    clientWidth: 506, clientHeight: 150, width: 0, height: 0,
    getContext() { return canvasSupport ? context() : null; },
    getBoundingClientRect: () => ({ left: -13, top: -30, right: 493, bottom: 120 }),
  };
  let lines = 1;
  const fallback = { getClientRects: () => Array.from({ length: lines }, () => ({})) };
  const globals = {
    window: browser, document, IS_REACT_ACT_ENVIRONMENT: true,
    getComputedStyle: () => ({ color: '#243c31', fontFamily: 'Newsreader', fontSize: '86px', fontStyle: 'normal' }),
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ...Object.fromEntries([['ResizeObserver', 'resize'], ['IntersectionObserver', 'intersection'], ['MutationObserver', 'theme']].map(([name, group]) => [name, class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers[group].push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    }])),
  };
  const previous = Object.entries(globals).map(([name, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    return [name, descriptor];
  });
  let renderer;
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return {
    frames, painted, observers, container, canvas, browser, document, motion, scheme,
    failDrawing() { drawFailure = true; },
    get renderer() { return renderer; },
    get ready() { return renderer.root.findAll(node => node.type === 'span' && node.props.className?.includes('tech-text-ready')).length > 0; },
    async mount(text = 'Find a place.', props = {}) {
      await act(async () => { renderer = TestRenderer.create(React.createElement(TechText, { text, fitToText: true, labels: false, draggable: false, ...props }), {
        createNodeMock(element) { return element.type === 'canvas' ? { ...canvas } : element.props.className === 'tech-text-fallback' ? fallback : container; },
      }); });
    },
    async update(text) { await act(async () => renderer.update(React.createElement(TechText, { text, fitToText: true, labels: false, draggable: false }))); },
    async frame(elapsed = 16) {
      now += elapsed;
      const queued = [...frames.values()]; frames.clear();
      await act(async () => { for (const callback of queued) callback(now); });
    },
    async view(visible) { await act(async () => observers.intersection.at(-1).callback([{ isIntersecting: visible }])); },
    async visibility(state) { await act(async () => { document.visibilityState = state; document.emit('visibilitychange'); }); },
    async preference(value) { await act(async () => { motion.matches = value; motion.emit('change'); }); },
    async wrap(count) { lines = count; await act(async () => observers.resize.at(-1).callback()); },
    async unmount() { await act(async () => renderer.unmount()); renderer = null; },
    async finishFonts() { await act(async () => { for (const resolve of pendingFonts) resolve([]); }); },
  };
}

test('Tech Text keeps actual English, Vietnamese and CMS text readable in a server-rendered H1', () => {
  for (const text of ['Find a place.', 'Feel at home.', 'Tìm một nơi.', 'Gọi là nhà.', 'A new headline from the CMS']) {
    const html = renderToString(React.createElement('h1', null, React.createElement(TechText, { text, fitToText: true })));
    assert.ok(html.includes(`<span class="tech-text-fallback">${text}</span>`));
    assert.ok(!html.includes('<canvas'));
    assert.ok(!html.includes('tech-text-ready'));
  }
});

test('Tech Text pauses offscreen and in a hidden tab, recovers after idle, and releases all work', async t => {
  const env = environment(t);
  await env.mount();
  assert.equal(env.frames.size, 0);
  assert.equal(env.ready, false);
  await env.view(true);
  await env.frame();
  assert.equal(env.ready, true);
  assert.equal(env.frames.size, 1);
  await env.visibility('hidden');
  assert.equal(env.frames.size, 0);
  await env.visibility('visible');
  await env.frame(120_000);
  assert.equal(env.ready, true);
  assert.equal(env.frames.size, 1);
  await env.view(false);
  assert.equal(env.frames.size, 0);
  await env.view(true);
  await env.frame();
  await env.unmount();
  await env.finishFonts();
  assert.equal(env.frames.size, 0);
  assert.equal(env.container.count(), 0);
  assert.equal(env.canvas.count(), 0);
  assert.equal(env.document.count(), 0);
  assert.equal(env.browser.count(), 0);
  assert.equal(env.motion.count(), 0);
  assert.equal(env.scheme.count(), 0);
  assert.ok(Object.values(env.observers).flat().every(observer => observer.disconnected));
});

test('Tech Text responds to live motion preference changes without hiding the native headline', async t => {
  const env = environment(t, { reduced: true });
  await env.mount();
  assert.equal(env.renderer.root.findAllByType('canvas').length, 0);
  await env.preference(false);
  await env.view(true);
  await env.frame();
  assert.equal(env.ready, true);
  await env.preference(true);
  assert.equal(env.frames.size, 0);
  assert.equal(env.ready, false);
  assert.equal(env.renderer.root.findByProps({ className: 'tech-text-fallback' }).children[0], 'Find a place.');
  await env.preference(false);
  assert.equal(env.ready, false);
  await env.view(true);
  await env.frame();
  assert.equal(env.ready, true);
});

test('Tech Text repaints edited and translated content, preserves combining marks, and falls back for wrapped lines', async t => {
  const env = environment(t);
  await env.mount();
  await env.view(true);
  await env.frame();
  env.painted.length = 0;
  await env.update('To\u0302i ở nhà.');
  assert.equal(env.ready, false);
  await env.frame();
  assert.ok(env.painted.includes('o\u0302'), 'one glyph contains the complete Vietnamese grapheme');
  assert.equal(env.ready, true);
  await env.wrap(2);
  await env.frame();
  assert.equal(env.ready, false);
  assert.equal(env.frames.size, 0);
  await env.wrap(1);
  await env.frame();
  assert.equal(env.ready, true);
});

test('missing canvas support preserves native text and starts no animation loop', async t => {
  const env = environment(t, { canvasSupport: false });
  await env.mount('Gọi là nhà.');
  assert.equal(env.ready, false);
  assert.equal(env.frames.size, 0);
  assert.equal(env.renderer.root.findByProps({ className: 'tech-text-fallback' }).children[0], 'Gọi là nhà.');
  assert.equal(env.container.count(), 0);
});


test('canvas context loss restores native text until the drawing context recovers', async t => {
  const env = environment(t);
  await env.mount();
  await env.view(true);
  await env.frame();
  assert.equal(env.ready, true);
  await act(async () => env.canvas.emit('contextlost'));
  assert.equal(env.ready, false);
  assert.equal(env.frames.size, 0);
  await act(async () => env.canvas.emit('contextrestored'));
  await env.frame();
  assert.equal(env.ready, true);
});

test('a drawing failure leaves the headline readable and stops further frames', async t => {
  const env = environment(t);
  await env.mount();
  await env.view(true);
  await env.frame();
  env.failDrawing();
  await env.frame();
  assert.equal(env.ready, false);
  assert.equal(env.frames.size, 0);
  assert.equal(env.renderer.root.findByProps({ className: 'tech-text-fallback' }).children[0], 'Find a place.');
});


test('the homepage hover mode sleeps at rest and stops again after the pointer leaves', async t => {
  const env = environment(t);
  await env.mount('Find a place.', { sweep: false });
  await env.view(true);
  await env.frame();
  assert.equal(env.ready, true);
  assert.equal(env.frames.size, 0);
  await act(async () => env.container.emit('pointerenter', { clientX: 20, clientY: 50 }));
  await env.frame();
  assert.equal(env.frames.size, 1);
  await act(async () => env.container.emit('pointerleave'));
  for (let frame = 0; frame < 100 && env.frames.size; frame++) await env.frame();
  assert.equal(env.frames.size, 0);
});
