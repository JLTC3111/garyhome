import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url), module = { exports: {} };
const source = ts.transpileModule(fs.readFileSync(new URL('../components/contact-widget-night-art.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
}).outputText;
vm.runInThisContext('(function(exports,require,module){' + source + '\n})')(module.exports, require, module);
const { ContactWidgetNightArt } = module.exports;

test('night artwork uses semantic shell/text colors and retains the original channel badge geometry and brand colors', () => {
  const original = fs.readFileSync(new URL('../public/svg/contact-widget-04-chat-with-us.svg', import.meta.url), 'utf8');
  const originalDefs = /<defs>([\s\S]*?)<\/defs>/.exec(original)[1];
  for (const label of ['Chat with us:', 'Nhắn tin:']) {
    const html = renderToStaticMarkup(React.createElement(ContactWidgetNightArt, { label }));
    const defs = /<defs>([\s\S]*?)<\/defs>/.exec(html)[1];
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /focusable="false"/);
    assert.match(html, /fill="var\(--home-surface\)"/);
    assert.match(html, /fill="var\(--home-text\)"/);
    assert.ok(html.includes(label));
    assert.equal((html.match(/<use /g) || []).length, 2);
    assert.deepEqual([...defs.matchAll(/<path[^>]* d="([^"]+)"/g)].map(match => match[1]),
      [...originalDefs.matchAll(/<path[^>]* d="([^"]+)"/g)].map(match => match[1]));
    assert.deepEqual([...defs.matchAll(/stop-color="([^"]+)"/g)].map(match => match[1]),
      [...originalDefs.matchAll(/stop-color="([^"]+)"/g)].map(match => match[1]).slice(0, 6));
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map(match => match[1]));
    for (const reference of html.matchAll(/(?:url\(#|href="#)([^)"]+)/g)) assert.ok(ids.has(reference[1]), reference[1]);
  }
});
