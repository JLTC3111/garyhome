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

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
// Load the headless library's client layout effects; refs remain null in this renderer.
const initialDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
Object.defineProperty(globalThis, 'document', { value: {}, configurable: true });
const { Select } = require('@base-ui/react/select');
if (initialDocument) Object.defineProperty(globalThis, 'document', initialDocument); else delete globalThis.document;
let language = 'en';
const site = { content: { properties:[], neighbourhoods: [{ slug: 'tay-ho', name: 'Tây Hồ' }, { slug: 'ba-dinh', name: 'Ba Đình' }] },
  t: (en, vi) => language === 'en' ? en : vi };
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const loadedModule = { exports: {} }; modules.set(file, loadedModule);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  function dependency(id) {
    if (id === './site-context') return { useSite: () => ({ ...site, language }) };
    if (id.startsWith('.') || id.startsWith('@/')) {
      const target = id.startsWith('@/') ? path.join(root,id.slice(2)) : path.resolve(path.dirname(file), id);
      return load([target,target + '.tsx', target + '.ts'].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile()));
    }
    return require(id);
  }
  vm.runInThisContext('(function(exports,require,module){' + code + '\n})', { filename: file })(loadedModule.exports, dependency, loadedModule);
  return loadedModule.exports;
}
const { SelectField } = load(path.join(root, 'components/select-field.tsx'));
const { SearchForm } = load(path.join(root, 'components/search-form.tsx'));
const options = vi => [React.createElement('option', { key: '', value: '' }, vi ? 'Mọi khu vực' : 'Anywhere'),
  React.createElement('option', { key: 'tay-ho', value: 'tay-ho' }, 'Tây Hồ'),
  React.createElement('option', { key: 'disabled', value: 'disabled', disabled: true }, vi ? 'Chưa có' : 'Unavailable')];

async function harness(t, content) {
  class Element {} class HTMLElement extends Element {}
  const browser = Object.assign(new EventTarget(), { Element, HTMLElement });
  const page = Object.assign(new EventTarget(), { body: { style: {} }, documentElement: {} });
  const globals = { window: browser, document: page, Element, HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.entries(globals).map(([name, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    return [name, descriptor];
  });
  let renderer;
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
    language = 'en';
  });
  await act(async () => { renderer = TestRenderer.create(content); });
  return renderer;
}

test('custom select server rendering exposes the selected label, accessible trigger and form value without a native picker', () => {
  const html = renderToString(React.createElement('form', null, React.createElement(SelectField, {
    name: 'district', defaultValue: 'tay-ho', 'aria-label': 'Neighbourhood', required: true,
  }, options(false))));
  assert.ok(!/<select\b|<option\b/.test(html));
  assert.match(html, /type="button"[^>]*role="combobox"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-label="Neighbourhood"/);
  assert.match(html, /class="site-select-value"[^>]*>Tây Hồ<\/span>/);
  assert.match(html, /<input[^>]*name="district"[^>]*value="tay-ho"/);
});

test('controlled selections and translated labels preserve the customer draft and submitted value', async t => {
  let updateLanguage;
  function CustomerDraft() {
    const [vi, setVi] = React.useState(false); updateLanguage = setVi;
    const [district, setDistrict] = React.useState('');
    const [name, setName] = React.useState('My unsaved name');
    return React.createElement('form', null, React.createElement('input', { name: 'full_name', value: name, onChange: event => setName(event.target.value) }),
      React.createElement(SelectField, { name: 'district', value: district, onValueChange: setDistrict, 'aria-label': vi ? 'Khu vực' : 'Neighbourhood' }, options(vi)));
  }
  const renderer = await harness(t, React.createElement(CustomerDraft));
  const select = () => renderer.root.findByType(Select.Root);
  await act(async () => select().props.onValueChange('tay-ho'));
  assert.equal(renderer.root.findAllByType('input').find(node => node.props.name === 'district').props.value, 'tay-ho');
  await act(async () => updateLanguage(true));
  assert.equal(select().props.value, 'tay-ho');
  assert.equal(renderer.root.findAll(node => node.type==='span' && node.props.className==='site-select-value')[0].children[0], 'Tây Hồ');
  assert.equal(renderer.root.findByProps({ name: 'full_name' }).props.value, 'My unsaved name');
  assert.equal(renderer.root.findByType('button').props['aria-label'], 'Khu vực');
  assert.equal(select().props.items.find(item => item.value === 'disabled').disabled, true);
});

test('language and price-period changes preserve rental search choices without duration controls', async t => {
  const initial = { district: 'tay-ho', type: 'Apartment', max: '600' };
  const renderer = await harness(t, React.createElement(SearchForm, { initial }));
  const values = () => Object.fromEntries(renderer.root.findAllByType('input').filter(node => node.props.name && node.props.type!=='checkbox').map(node => [node.props.name, node.props.value ?? node.props.defaultValue]));
  assert.equal(values().max,'600');assert.equal(values().district,'tay-ho');
  const period=renderer.root.findAllByType(Select.Root).find(node=>node.props.name==='period');
  await act(async()=>period.props.onValueChange('night'));
  language='vi';await act(async()=>renderer.update(React.createElement(SearchForm,{initial})));
  assert.equal(values().period,'night');assert.equal(values().district,'tay-ho');assert.equal(values().type,'Apartment');assert.equal(values().max,'600');
  assert.ok(!('term' in values()));assert.ok(!JSON.stringify(renderer.toJSON()).includes('Thuê dài hạn'));
});
