import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = ts.transpileModule(fs.readFileSync(new URL('../components/site-preferences.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
}).outputText;

async function controls(t, { language = 'en', pathname = '/en', studio = false } = {}) {
  const previous = new Map();
  for (const [name, value] of Object.entries({
    IS_REACT_ACT_ENVIRONMENT: true,
    document: { addEventListener() {}, removeEventListener() {} }
  })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  const selections = [], saved = [], localeChanges = [], focus = [];
  const module = { exports: {} };
  const Segment = props => React.createElement('div', { 'data-choice-group': props['aria-label'] },
    props.items.map(item => React.createElement('button', { key: item.value, 'data-value': item.value,
      'aria-checked': props.value === item.value, onClick: () => props.onChange(item.value) }, item.label))
  );
  vm.runInThisContext('(function(exports,require,module){' + source + '\n})')(module.exports, id => {
    if (id === './site-context') return { useSite: () => ({ language, currency: 'USD', setLanguage: value => localeChanges.push(value), t: (en, vi) => language === 'vi' ? vi : en }) };
    if (id === 'next-themes') return { useTheme: () => ({ theme: 'dark', setTheme: value => selections.push(value) }) };
    if (id === 'next/navigation') return { usePathname: () => pathname };
    if (id === '@/lib/localized-routes') return { isPublicPagePath: value => !['/account', '/auth/reset', '/admin'].includes(value) };
    if (id === '@/lib/public-theme') return { isHomeTheme: value => ['light', 'dark', 'system'].includes(value), persistHomeTheme: value => saved.push(value) };
    if (id === './currency-switcher') return { CurrencySwitcher: () => React.createElement('span', null, 'USD / VND') };
    if (id === './react-bits/rubber-segment') return { __esModule: true, default: Segment };
    return require(id);
  }, module);
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(module.exports.SitePreferences, { studio }), {
    createNodeMock: node => ({ contains: () => false, querySelector: () => null, focus() { focus.push(node.props.className); } })
  }); });
  await act(async () => renderer.root.findByProps({ 'aria-haspopup': 'dialog' }).props.onClick());
  t.after(async () => {
    await act(async () => renderer.unmount());
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return { renderer, selections, saved, localeChanges, focus };
}

for (const language of ['en', 'vi']) test(`header preference choices dispatch Light/Dark/System without changing ${language} language or currency`, async t => {
  const ui = await controls(t, { language, pathname: '/' + language });
  const group = ui.renderer.root.findByProps({ 'data-choice-group': language === 'en' ? 'Color theme' : 'Chế độ giao diện' });
  assert.deepEqual(group.findAllByType('button').map(button => button.children.join('')), language === 'en' ? ['Light', 'Dark', 'System'] : ['Sáng', 'Tối', 'Hệ thống']);
  assert.equal(group.findByProps({ 'data-value': 'dark' }).props['aria-checked'], true);
  for (const value of ['light', 'dark', 'system']) await act(async () => group.findByProps({ 'data-value': value }).props.onClick());
  assert.deepEqual(ui.selections, ['light', 'dark', 'system']);
  assert.deepEqual(ui.saved, ui.selections);
  assert.deepEqual(ui.localeChanges, []);
  assert.ok(ui.renderer.root.findAllByType('span').some(span => span.children.includes('USD / VND')));
});

test('staff preferences group language and appearance and return focus on Escape', async t => {
  const ui = await controls(t, { language: 'vi', pathname: '/admin', studio: true });
  const dialog = ui.renderer.root.findByProps({ role: 'dialog' });
  assert.equal(dialog.props['aria-label'], 'Ngôn ngữ và giao diện');
  const language = dialog.findByProps({ 'data-choice-group': 'Ngôn ngữ' });
  assert.equal(language.findByProps({ 'data-value': 'vi' }).props['aria-checked'], true);
  const group = dialog.findByProps({ 'data-choice-group': 'Chế độ giao diện' });
  assert.deepEqual(group.findAllByType('button').map(button => button.children.join('')), ['Sáng', 'Tối', 'Hệ thống']);
  assert.deepEqual(dialog.findAllByType('legend').map(legend => legend.children.join('')), ['Ngôn ngữ', 'Giao diện']);
  await act(async () => language.findByProps({ 'data-value': 'en' }).props.onClick());
  await act(async () => group.findByProps({ 'data-value': 'system' }).props.onClick());
  assert.deepEqual(ui.localeChanges, ['en']);
  assert.deepEqual(ui.selections, ['system']);
  assert.deepEqual(ui.saved, ui.selections);
  const wrapper = ui.renderer.root.findByProps({ className: 'site-preferences studio-preferences' });
  let stopped = false;
  await act(async () => wrapper.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() { stopped = true; } }));
  assert.equal(stopped, true, 'an outer editor cannot receive Escape from an open preferences panel');
  assert.equal(wrapper.findAllByProps({ role: 'dialog' }).length, 0);
  assert.deepEqual(ui.focus, ['site-preferences-trigger']);
});

test('customer portal header retains language/currency preferences without advertising an inactive public theme control', async t => {
  const ui = await controls(t, { pathname: '/account' });
  assert.equal(ui.renderer.root.findAll(node => node.props['data-choice-group'] === 'Color theme').length, 0);
  assert.deepEqual(ui.selections, []);
});
