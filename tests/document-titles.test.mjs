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

const base = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const modules = new Map();
const property = { id:'test-home',listing_type:'rent',property_type:'Apartment',bedrooms:2,bathrooms:1,area_sqm:80,address:'Tây Hồ',district_slug:'tay-ho',amenities:['Balcony'], slug: 'home-by-the-lake', title_en: 'A home by the lake', title_vi: 'Tổ ấm bên hồ', status: 'published', availability: 'available' };
let pathname = '/account';
let site = { language: 'en', content: { properties: [property] } };
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const loadedModule = { exports: {} }; modules.set(file, loadedModule);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  function dependency(id) {
    if (id === 'next/navigation') return { usePathname: () => pathname };
    if (id === './site-context') return { useSite: () => site };
    if (id.startsWith('@/')) return load(path.join(base, id.slice(2) + '.ts'));
    if (id.startsWith('.')) return load(path.resolve(path.dirname(file),id));
    return require(id);
  }
  vm.runInThisContext('(function(exports,require,module){' + source + '\n})', { filename: file })(loadedModule.exports, dependency, loadedModule);
  return loadedModule.exports;
}
const { documentTitle } = load(path.join(base, 'lib/document-titles.ts'));
const { DocumentTitle } = load(path.join(base, 'components/document-title.tsx'));

test('every public, customer and staff route has a title in the selected language', () => {
  const cases = [
    ['/homes', 'Hanoi rental properties', 'Bất động sản cho thuê Hà Nội'],
    ['/saved', 'Your saved homes', 'Nhà đã lưu'],
    ['/neighbourhoods', 'Find your kind of Hanoi', 'Tìm khu phố dành cho bạn'],
    ['/about', 'The Gary way', 'Về Gary Home'],
    ['/contact', 'Contact us', 'Liên hệ'],
    ['/login', 'Choose your login portal', 'Chọn cổng đăng nhập'],
    ['/account', 'Customer Portal', 'Cổng khách hàng'],
    ['/admin', 'Staff Portal · Gary Home Studio', 'Cổng nhân viên · Gary Home Studio'],
    ['/auth/invite', 'Join the Gary Home team', 'Gia nhập đội ngũ Gary Home'],
    ['/auth/reset', 'Reset your password', 'Đặt lại mật khẩu'],
    ['/privacy', 'Privacy', 'Chính sách bảo mật'],
    ['/credits', 'Photo credits', 'Nguồn ảnh'],
  ];
  for (const [route, en, vi] of cases) {
    assert.equal(documentTitle(route, 'en', []), `${en} | Gary Home`);
    assert.equal(documentTitle(route + '/', 'vi', []), `${vi} | Gary Home`);
  }
  assert.equal(documentTitle('/', 'en', []), 'Serviced apartments in Hanoi for rent | Gary Home');
  assert.equal(documentTitle('/', 'vi', []), 'Căn hộ dịch vụ cho thuê tại Hà Nội | Gary Home');
  assert.equal(documentTitle('/unknown', 'vi', []), 'Không tìm thấy trang | Gary Home');
  assert.equal(documentTitle(null, 'vi', []), null);
});

test('property titles use current CMS translations and never expose unavailable or private listings', () => {
  const route = '/homes/home-by-the-lake';
  assert.equal(documentTitle(route, 'en', [property]), '2-bedroom apartment for rent in Tây Hồ · 80 m² · Balcony | Gary Home');
  assert.equal(documentTitle(route, 'vi', [property]), 'Căn hộ 2 phòng ngủ cho thuê tại Tây Hồ · 80 m² · Ban công | Gary Home');
  assert.equal(documentTitle(route, 'vi', [{ ...property, title_vi: '  ' }]), 'Căn hộ 2 phòng ngủ cho thuê tại Tây Hồ · 80 m² · Ban công | Gary Home');
  assert.equal(documentTitle(route, 'vi', [{ ...property, bedrooms: 3 }]), 'Căn hộ 3 phòng ngủ cho thuê tại Tây Hồ · 80 m² · Ban công | Gary Home');
  for (const change of [{ status: 'draft' }, { status: 'archived' }, { availability: 'rented' }, { availability: 'sold' }]) {
    assert.equal(documentTitle(route, 'vi', [{ ...property, ...change }]), 'Không tìm thấy căn nhà | Gary Home');
  }
  assert.equal(documentTitle('/homes/%E0%A4%A', 'en', [property]), 'Home not found | Gary Home');
});

async function harness(t, { strict = false } = {}) {
  const observers = [], listeners = new Set();
  let currentTitle = 'Server title', writes = 0, renderer;
  const page = { head: {} };
  Object.defineProperty(page, 'title', { get: () => currentTitle, set: value => { currentTitle = value; writes++; } });
  const browser = {
    addEventListener(type, callback) { assert.equal(type, 'pageshow'); listeners.add(callback); },
    removeEventListener(type, callback) { assert.equal(type, 'pageshow'); listeners.delete(callback); },
  };
  const globals = {
    document: page, window: browser, IS_REACT_ACT_ENVIRONMENT: true,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe(target) { assert.equal(target, page.head); }
      disconnect() { this.disconnected = true; }
    },
  };
  const previous = Object.entries(globals).map(([name, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
    return [name, descriptor];
  });
  let mounts = 0;
  function Draft() {
    const [value, setValue] = React.useState('');
    React.useEffect(() => { mounts++; }, []);
    return React.createElement('input', { value, onChange: event => setValue(event.target.value) });
  }
  const tree = () => React.createElement(strict ? React.StrictMode : React.Fragment, null,
    React.createElement(DocumentTitle), React.createElement(Draft));
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
    pathname = '/account'; site = { language: 'en', content: { properties: [property] } };
  });
  await act(async () => { renderer = TestRenderer.create(tree()); });
  return {
    page, observers, listeners, renderer,
    get mounts() { return mounts; }, get writes() { return writes; },
    redraw: async () => { await act(async () => renderer.update(tree())); },
    unmount: async () => { await act(async () => renderer.unmount()); renderer = null; },
  };
}

test('language, navigation and CMS changes update the tab without remounting a customer draft', async t => {
  assert.equal(renderToString(React.createElement(DocumentTitle)), '', 'No browser APIs or duplicate title elements during server rendering');
  const h = await harness(t);
  await act(async () => h.renderer.root.findByType('input').props.onChange({ target: { value: 'Unsaved viewing notes' } }));
  site = { ...site, language: 'vi' }; await h.redraw();
  assert.equal(h.page.title, 'Cổng khách hàng | Gary Home');
  pathname = '/admin'; await h.redraw();
  assert.equal(h.page.title, 'Cổng nhân viên · Gary Home Studio | Gary Home');
  pathname = '/homes/home-by-the-lake'; await h.redraw();
  assert.equal(h.page.title, 'Căn hộ 2 phòng ngủ cho thuê tại Tây Hồ · 80 m² · Ban công | Gary Home');
  site = { ...site, content: { properties: [{ ...property, bedrooms: 3 }] } }; await h.redraw();
  assert.equal(h.page.title, 'Căn hộ 3 phòng ngủ cho thuê tại Tây Hồ · 80 m² · Ban công | Gary Home');
  assert.equal(h.renderer.root.findByType('input').props.value, 'Unsaved viewing notes');
  assert.equal(h.mounts, 1);
  assert.equal(h.observers.filter(observer => !observer.disconnected).length, 1);
  await h.unmount();
  assert.equal(h.listeners.size, 0);
  assert.ok(h.observers.every(observer => observer.disconnected));
});

test('late framework metadata and restored tabs cannot retain the wrong title or start a mutation loop', async t => {
  pathname = '/contact'; site = { ...site, language: 'vi' };
  const h = await harness(t, { strict: true });
  const active = () => h.observers.find(observer => !observer.disconnected);
  h.page.title = 'Say hello | Gary Home'; active().callback();
  assert.equal(h.page.title, 'Liên hệ | Gary Home');
  const writes = h.writes; active().callback();
  assert.equal(h.writes, writes, 'An already correct title does not create another mutation');
  h.page.title = 'Stale title from history'; for (const callback of h.listeners) callback();
  assert.equal(h.page.title, 'Liên hệ | Gary Home');
  const stale = active();
  site = { ...site, language: 'en' }; await h.redraw(); stale.callback();
  assert.equal(h.page.title, 'Contact us | Gary Home');
  assert.equal(h.listeners.size, 1);
  await h.unmount();
  h.page.title = 'Another page'; for (const observer of h.observers) observer.callback();
  assert.equal(h.page.title, 'Another page', 'Cleaned-up callbacks cannot change another page');
});
