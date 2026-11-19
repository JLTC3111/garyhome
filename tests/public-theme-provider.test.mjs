import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TestRenderer, { act } from 'react-test-renderer';
import ts from 'typescript';
import * as localizedRoutes from '../lib/localized-routes.ts';

const require = createRequire(import.meta.url);
function loadSource(path, imports, globals) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText;
  const script = new vm.Script('(function(exports,require,module){' + source + '\n})');
  const load = globals ? script.runInNewContext(globals) : script.runInThisContext();
  load(module.exports, id => imports[id] ?? require(id), module);
  return module.exports;
}

const themeImports = { './public-routes': { PUBLIC_LANDING_PATHS: ['/'] }, './localized-routes': localizedRoutes };
const preferences = loadSource('../lib/public-theme.ts', themeImports);
const key = preferences.HOME_THEME_STORAGE_KEY;
function loadProvider(imports = {}) {
  return loadSource('../components/public-theme-provider.tsx', {
    'next/navigation': { usePathname: () => '/en' },
    '@/lib/public-theme': preferences,
    ...imports
  }).PublicThemeProvider;
}

test('actual next-themes SSR output resolves stored and system themes before the readable page content', () => {
  const Provider = loadProvider();
  const html = renderToStaticMarkup(React.createElement(Provider, null,
    React.createElement('h1', null, 'A place to call home.'), React.createElement('p', null, 'Một nơi để gọi là nhà.')
  ));
  const preferenceScript = /<script[^>]*id="gary-home-theme-preference"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  const script = /<script[^>]*id="gary-home-theme-bootstrap"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(preferenceScript && script, 'the preference and next-themes bootstraps are present');
  assert.ok(html.indexOf(preferenceScript[0]) < html.indexOf(script[0]), 'the shared cookie takes precedence before next-themes runs');
  assert.ok(html.indexOf(script[0]) < html.indexOf('<h1>'), 'theme resolves before the page is painted');
  assert.match(html, /<h1>A place to call home\.<\/h1>/);
  assert.match(html, /Một nơi để gọi là nhà/);
  for (const [stored, systemDark, expected, cookie = '', storageBlocked = false] of [
    [null, false, 'light'], [null, true, 'dark'], ['system', true, 'dark'], ['system', false, 'light'],
    ['light', true, 'light'], ['dark', false, 'dark'], ['invalid', true, 'dark'],
    ['light', false, 'dark', `${key}=dark`], [null, true, 'light', `another=1; ${key}=light`],
    ['dark', false, 'light', `${key}=system; another=1`], ['dark', false, 'dark', `${key}=invalid`],
    [null, false, 'dark', `${key}=dark`, true]
  ]) {
    const attributes = {};
    let localTheme = stored;
    const root = { setAttribute(name, value) { attributes[name] = value; }, style: {} };
    const environment = vm.createContext({
      document: { cookie, documentElement: root },
      window: { matchMedia: query => ({ matches: query === '(prefers-color-scheme: dark)' && systemDark }) },
      localStorage: {
        getItem(name) { assert.equal(name, key); if (storageBlocked) throw new Error('Storage blocked'); return localTheme; },
        setItem(name, value) { assert.equal(name, key); localTheme = value; },
        removeItem(name) { assert.equal(name, key); localTheme = null; }
      }
    });
    vm.runInContext(preferenceScript[1], environment);
    vm.runInContext(script[1], environment);
    assert.equal(attributes['data-home-theme'], expected, `${stored} / system dark=${systemDark} / ${cookie}`);
    assert.equal(root.style.colorScheme, undefined, 'route styles control the native color scheme');
  }
});

test('the preference cookie shares only the production Gary Home domain', () => {
  const cookieWrites = [];
  const document = { set cookie(value) { cookieWrites.push(value); } };
  const window = { location: {} };
  const { persistHomeTheme } = loadSource('../lib/public-theme.ts', themeImports, { document, window });
  for (const hostname of ['www.garyhome.vn', 'staff.garyhome.vn', 'preview.example.org', 'localhost']) {
    window.location = { hostname, protocol: hostname === 'localhost' ? 'http:' : 'https:' };
    persistHomeTheme('system');
  }
  const base = `${key}=system; Path=/; Max-Age=31536000; SameSite=Lax`;
  assert.deepEqual(cookieWrites, [base + '; Domain=garyhome.vn; Secure', base + '; Domain=garyhome.vn; Secure', base + '; Secure', base]);
});

test('the provider migrates a stored choice and adopts shared updates on cookie changes and page return', async t => {
  const browser = new EventTarget();
  browser.location = { hostname: 'staff.garyhome.vn', protocol: 'https:' };
  browser.cookieStore = new EventTarget();
  const cookieDocument = { cookie: '', documentElement: { dataset: {} } };
  const globals = { window: browser, document: cookieDocument, localStorage: { getItem: () => 'dark' }, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.fromEntries(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true });

  const changes = [];
  const context = React.createContext();
  let pathname = '/en';
  const Provider = loadProvider({ 'next/navigation': { usePathname: () => pathname }, 'next-themes': {
    ThemeProvider: ({ children }) => {
      const [theme, setTheme] = React.useState('dark');
      return React.createElement(context.Provider, { value: { theme, setTheme: value => { changes.push(value); setTheme(value); } } }, children);
    },
    useTheme: () => React.useContext(context)
  } });
  let renderer;
  t.after(async () => {
    await act(async () => renderer?.unmount());
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  await act(async () => { renderer = TestRenderer.create(React.createElement(Provider)); });
  for (const [route, scope] of [['/account', 'true'], ['/saved', 'true'], ['/admin', 'false']]) {
    pathname = route;
    await act(async () => renderer.update(React.createElement(Provider)));
    assert.equal(cookieDocument.documentElement.dataset.homePublic, scope, route);
  }
  assert.match(cookieDocument.cookie, new RegExp(`^${key}=dark;`));
  assert.deepEqual(changes, []);

  const cookieChanged = name => browser.cookieStore.dispatchEvent(Object.assign(new Event('change'), { changed: [{ name }] }));
  cookieDocument.cookie = `${key}=light`;
  cookieChanged('another-cookie');
  assert.deepEqual(changes, []);
  await act(async () => cookieChanged(key));
  cookieDocument.cookie = `${key}=system`;
  await act(async () => browser.dispatchEvent(new Event('focus')));
  cookieDocument.cookie = `${key}=dark`;
  await act(async () => browser.dispatchEvent(new Event('pageshow')));
  cookieDocument.cookie = `${key}=invalid`;
  browser.dispatchEvent(new Event('pageshow'));
  assert.deepEqual(changes, ['light', 'system', 'dark']);
});
