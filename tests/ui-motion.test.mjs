import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { renderToString } from 'react-dom/server';
import ts from 'typescript';

const compiled = ts.transpileModule(fs.readFileSync(new URL('../components/use-motion-preference.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
vm.runInThisContext('(function(exports,require,module){' + compiled + '\n})')(
  loaded.exports, id => { assert.equal(id, 'react'); return React; }, loaded,
);
const { useMotionPreference } = loaded.exports;

function platform(t, browser) {
  const names = ['window', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  Object.defineProperty(globalThis, 'window', { value: browser, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true, writable: true });
  t.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
}

test('SSR uses a stable reduced-motion preference without consulting the browser', t => {
  platform(t, { matchMedia() { throw new Error('Browser APIs must not run during SSR'); } });
  function Probe() { return React.createElement('output', null, String(useMotionPreference())); }
  assert.equal(renderToString(React.createElement(Probe)), '<output>true</output>');
});

test('live motion preference changes preserve drafts and release media listeners on unmount', async t => {
  let renderer;
  t.after(async () => { if (renderer) await act(async () => renderer.unmount()); });
  const callbacks = new Set();
  const media = {
    matches: false,
    addEventListener(type, callback) { assert.equal(type, 'change'); callbacks.add(callback); },
    removeEventListener(type, callback) { assert.equal(type, 'change'); callbacks.delete(callback); },
  };
  platform(t, { matchMedia(query) { assert.equal(query, '(prefers-reduced-motion: reduce)'); return media; } });
  let mounts = 0;
  function Probe() {
    const reduced = useMotionPreference();
    const [draft, setDraft] = React.useState('');
    React.useEffect(() => { mounts++; }, []);
    return React.createElement('div', { 'data-reduced': reduced }, React.createElement('input', {
      value: draft, onChange: event => setDraft(event.target.value),
    }));
  }
  await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); });
  assert.equal(renderer.root.findByType('div').props['data-reduced'], false);
  await act(async () => renderer.root.findByType('input').props.onChange({ target: { value: 'Unsaved viewing notes' } }));
  for (const preference of [true, false, true]) {
    await act(async () => { media.matches = preference; for (const callback of callbacks) callback(); });
    assert.equal(renderer.root.findByType('div').props['data-reduced'], preference);
    assert.equal(renderer.root.findByType('input').props.value, 'Unsaved viewing notes');
    assert.equal(mounts, 1);
  }
  assert.equal(callbacks.size, 1);
  await act(async () => renderer.unmount());
  renderer = null;
  assert.equal(callbacks.size, 0);
});

test('legacy media-query listeners work and a missing preference API disables motion', async t => {
  let renderer;
  t.after(async () => { if (renderer) await act(async () => renderer.unmount()); });
  const callbacks = new Set();
  const media = {
    matches: false,
    addListener: callback => callbacks.add(callback),
    removeListener: callback => callbacks.delete(callback),
  };
  const browser = { matchMedia: () => media };
  platform(t, browser);
  function Probe() { return React.createElement('output', null, String(useMotionPreference())); }
  await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); });
  assert.equal(renderer.root.findByType('output').children[0], 'false');
  await act(async () => { media.matches = true; for (const callback of callbacks) callback(); });
  assert.equal(renderer.root.findByType('output').children[0], 'true');
  await act(async () => renderer.unmount()); renderer = null;
  assert.equal(callbacks.size, 0);
  delete browser.matchMedia;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); });
  assert.equal(renderer.root.findByType('output').children[0], 'true');
});
