import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function loadProvider() {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(new URL('../components/public-theme-provider.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText;
  vm.runInThisContext('(function(exports,require,module){' + source + '\n})')(
    module.exports, id => {
      if (id === 'next/navigation') return { usePathname: () => '/en' };
      if (id === '@/lib/localized-routes') return { isPublicPagePath: () => true };
      if (id === '@/lib/public-theme') return { HOME_THEME_STORAGE_KEY: 'gary-home-theme' };
      return require(id);
    }, module
  );
  return module.exports.PublicThemeProvider;
}
const Provider = loadProvider();

test('actual next-themes SSR output resolves stored and system themes before the readable page content', () => {
  const html = renderToStaticMarkup(React.createElement(Provider, null,
    React.createElement('h1', null, 'A place to call home.'), React.createElement('p', null, 'Một nơi để gọi là nhà.')
  ));
  const script = /<script[^>]*id="gary-home-theme-bootstrap"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(script, 'the installed next-themes SSR bootstrap is present');
  assert.ok(html.indexOf(script[0]) < html.indexOf('<h1>'), 'theme resolves before the page is painted');
  assert.match(html, /<h1>A place to call home\.<\/h1>/);
  assert.match(html, /Một nơi để gọi là nhà/);
  for (const [stored, systemDark, expected] of [
    [null, false, 'light'], [null, true, 'dark'], ['system', true, 'dark'],
    ['system', false, 'light'], ['light', true, 'light'], ['dark', false, 'dark']
  ]) {
    const attributes = {};
    const root = { setAttribute(name, value) { attributes[name] = value; }, style: {} };
    vm.runInNewContext(script[1], {
      document: { documentElement: root },
      window: { matchMedia: query => ({ matches: query === '(prefers-color-scheme: dark)' && systemDark }) },
      localStorage: { getItem(key) { assert.equal(key, 'gary-home-theme'); return stored; } }
    });
    assert.equal(attributes['data-home-theme'], expected, `${stored} / system dark=${systemDark}`);
    assert.equal(root.style.colorScheme, undefined, 'provider does not change native staff colors globally');
  }
});
