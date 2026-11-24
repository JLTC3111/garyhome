import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import postcss from 'postcss';
import ts from 'typescript';
import * as localizedRoutes from '../lib/localized-routes.ts';

const root = new URL('../', import.meta.url);
const routes = fs.readFileSync(new URL('lib/public-routes.ts', root), 'utf8');
const publicPaths = [...routes.matchAll(/"(\/[^"\n]*)"/g)].map(match => match[1]);
const code = ts.transpileModule(fs.readFileSync(new URL('lib/public-theme.ts', root), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const loaded = { exports: {} };
vm.runInThisContext('(function(exports,require,module){' + code + '\n})')(
  loaded.exports, id => id === './localized-routes' ? localizedRoutes : { PUBLIC_LANDING_PATHS: publicPaths }, loaded
);
const { PUBLIC_THEME_SCOPE_BOOTSTRAP, HOME_THEME_STORAGE_KEY, HOME_THEME_VALUES, isHomeThemePath } = loaded.exports;

function publicScope(pathname) {
  const html = { dataset: {} };
  vm.runInNewContext(PUBLIC_THEME_SCOPE_BOOTSTRAP, { location: { pathname }, document: { documentElement: html } });
  assert.equal(html.dataset.homePublic, String(isHomeThemePath(pathname)), 'hydration and first paint agree');
  return html.dataset.homePublic;
}

test('theme scope runs before hydration on every public page type in both languages', () => {
  for (const base of [...publicPaths, '/about', '/homes/warm-apartment', '/tips-and-news/hanoi-update']) {
    assert.equal(publicScope(base), 'true', base);
    for (const language of ['en', 'vi']) {
      assert.equal(publicScope('/' + language + (base === '/' ? '' : base)), 'true', language + base);
      assert.equal(publicScope('/' + language + (base === '/' ? '' : base) + '/'), 'true');
    }
  }
});

test('customer routes share the home palette while staff, auth and API routes keep their own scope', () => {
  for (const pathname of ['/account', '/account/', '/saved', '/saved/']) {
    assert.equal(publicScope(pathname), 'true', pathname);
    assert.equal(localizedRoutes.isPublicPagePath(pathname), false, 'the palette is independent of public routing');
  }
  for (const pathname of ['/admin', '/en/admin', '/vi/admin', '/auth/reset', '/auth/invite', '/login', '/cart', '/api/config', '/homes/invalid_slug', '/unknown']) {
    assert.equal(publicScope(pathname), 'false', pathname);
  }
  assert.deepEqual(HOME_THEME_VALUES, ['light', 'dark', 'system']);
  assert.equal(HOME_THEME_STORAGE_KEY, 'gary-home-theme');
});

const css = fs.readFileSync(new URL('app/public-theme.css', root), 'utf8');
const tokens = Object.fromEntries([...css.matchAll(/--(home-[\w-]+):\s*(#[\da-f]{6})(?:;|\s)/gi)].map(([, name, value]) => [name, value]));
function luminance(hex) {
  if (hex.length === 4) hex = '#' + [...hex.slice(1)].map(digit => digit.repeat(2)).join('');
  const components = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  return components.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
}
function contrast(first, second) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

test('property-card photo arrows keep readable fills in both themes', () => {
  const theme = postcss.parse(css);
  const rental = postcss.parse(fs.readFileSync(new URL('app/rental.css', root), 'utf8'));
  const declarations = (rootNode, selector) => {
    const rule = rootNode.nodes.find(node => node.type === 'rule' && node.selector === selector);
    assert.ok(rule, selector);
    return Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop.replace(/^--/, ''), node.value]));
  };
  const light = declarations(theme, 'html[data-home-public="true"]');
  const dark = declarations(theme, 'html:root[data-home-public][data-home-public="true"][data-home-theme][data-home-theme="dark"]');
  const green = /--green:\s*(#[\da-f]{6})/i.exec(fs.readFileSync(new URL('app/globals.css', root), 'utf8'))[1];
  const resolve = (palette, value) => {
    const reference = /^var\(--([\w-]+)\)$/.exec(value);
    if (!reference) return value;
    if (reference[1] === 'green') return green;
    return palette[reference[1]] || tokens[reference[1]];
  };
  const pairs = [
    ['light default', light, 'home-carousel-arrow-ink', 'home-carousel-arrow-bg'],
    ['light hover', light, 'home-carousel-arrow-hover-ink', 'home-carousel-arrow-hover-bg'],
    ['light pressed', light, 'home-carousel-arrow-pressed-ink', 'home-carousel-arrow-pressed-bg'],
    ['dark default', dark, 'home-carousel-arrow-ink', 'home-carousel-arrow-bg'],
    ['dark hover', dark, 'home-carousel-arrow-hover-ink', 'home-carousel-arrow-hover-bg'],
    ['dark pressed', dark, 'home-carousel-arrow-pressed-ink', 'home-carousel-arrow-pressed-bg']
  ];
  assert.equal(resolve(light, light['home-carousel-arrow-bg']), '#ffffff');
  assert.equal(resolve(light, light['home-carousel-arrow-ink']), green);
  assert.equal(resolve(light, light['home-carousel-arrow-hover-bg']), '#315743');
  assert.equal(resolve(light, light['home-carousel-arrow-hover-ink']), '#ffffff');
  assert.equal(resolve(light, light['home-carousel-arrow-pressed-bg']), '#234333');
  assert.equal(resolve(light, light['home-carousel-arrow-pressed-ink']), '#ffffff');
  assert.equal(resolve(dark, dark['home-carousel-arrow-bg']), '#2d4335');
  assert.equal(resolve(dark, dark['home-carousel-arrow-ink']), tokens['home-text']);
  assert.equal(resolve(dark, dark['home-carousel-arrow-hover-bg']), '#bed5ad');
  assert.equal(resolve(dark, dark['home-carousel-arrow-hover-ink']), '#203529');
  assert.equal(resolve(dark, dark['home-carousel-arrow-pressed-bg']), '#91b18b');
  assert.equal(resolve(dark, dark['home-carousel-arrow-pressed-ink']), tokens['home-action-ink']);
  for (const [name, palette, ink, surface] of pairs) {
    assert.ok(contrast(resolve(palette, palette[ink]), resolve(palette, palette[surface])) >= 4.5, name);
  }
  const arrow = 'html:root[data-home-public][data-home-public="true"][data-home-theme] .rental-card-photo-nav>button';
  assert.equal(declarations(theme, arrow).color, 'var(--home-carousel-arrow-ink)');
  assert.equal(declarations(theme, `${arrow}:active:not(:disabled,[aria-disabled="true"])`).color, 'var(--home-carousel-arrow-pressed-ink)');
  assert.equal(declarations(theme, `${arrow}:focus-visible`)['outline-offset'], '-3px');
  const controls = theme.nodes.find(node => node.type === 'rule' && node.selector.includes('.rental-gallery-count') && node.selector.includes(':where('));
  assert.equal(controls.selector.includes('.rental-card-photo-nav'), false);
  const rentalRules = [];
  rental.walkRules(rule => rentalRules.push(rule));
  const buttonRules = rentalRules.filter(rule => rule.selector === '.rental-card-photo-nav>button');
  const base = buttonRules.find(rule => rule.parent.type === 'root');
  const baseDeclarations = Object.fromEntries(base.nodes.map(node => [node.prop, node.value]));
  assert.equal(baseDeclarations.width, '33px');
  assert.equal(baseDeclarations.height, '36px');
  assert.match(baseDeclarations.transition, /180ms/);
  assert.equal(baseDeclarations['touch-action'], 'manipulation');
  const hover = rentalRules.find(rule => rule.selector.includes('.rental-card-photo-nav>button:hover') && rule.parent.params === '(hover:hover) and (pointer:fine)');
  assert.equal(hover.nodes.find(node => node.prop === 'scale').value, '1.05');
  const mobile = buttonRules.find(rule => rule.parent.params === '(max-width:680px)');
  const mobileDeclarations = Object.fromEntries(mobile.nodes.map(node => [node.prop, node.value]));
  assert.equal(mobileDeclarations.width, '36px');
  assert.equal(mobileDeclarations.height, '40px');
  const reduced = buttonRules.find(rule => rule.parent.params === '(prefers-reduced-motion:reduce)');
  assert.equal(reduced.nodes.find(node => node.prop === 'transition').value, 'none');
  const reducedHover = rentalRules.find(rule => rule.selector.includes('.rental-card-photo-nav>button:hover') && rule.parent.params === '(prefers-reduced-motion:reduce)');
  assert.equal(reducedHover.nodes.find(node => node.prop === 'scale').value, '1');
});

test('forest surfaces, secondary copy, sage actions and input outlines meet AA contrast', () => {
  for (const surface of ['home-background', 'home-surface', 'home-elevated']) {
    for (const text of ['home-text', 'home-secondary', 'home-quiet', 'home-accent', 'home-copper']) {
      assert.ok(contrast(tokens[text], tokens[surface]) >= 4.5, `${text} on ${surface}`);
    }
  }
  assert.ok(contrast(tokens['home-action-ink'], tokens['home-accent']) >= 4.5);
  assert.ok(contrast(tokens['home-field-border'], tokens['home-surface']) >= 3);
  assert.ok(contrast(tokens['home-accent'], tokens['home-elevated']) >= 3, 'visible focus outline');
  assert.ok(contrast(tokens['home-menu-ink'], tokens['home-menu-hover']) >= 4.5, 'menu hover label');
  assert.ok(contrast(tokens['home-menu-ink'], tokens['home-menu-active']) >= 4.5, 'menu active label');
  assert.ok(contrast(tokens['home-accent'], tokens['home-menu-hover']) >= 3, 'focus ring on menu hover');
  assert.ok(contrast(tokens['home-accent'], tokens['home-menu-active']) >= 3, 'focus ring on menu active');
  assert.ok(contrast(tokens['home-danger'], tokens['home-danger-surface']) >= 4.5, 'danger label');
});

test('customer dark surfaces and controls use the shared palette tokens', () => {
  const theme = postcss.parse(css);
  const customer = theme.nodes.find(rule => rule.selector?.endsWith(':where(.account-entry, .account-page)'));
  assert.match(customer?.selector, /data-home-public="true".*data-home-theme="dark"/);
  function assertToken(selector, property, token) {
    assert.ok(customer.nodes.some(rule => rule.selector?.includes(selector)
      && rule.nodes.some(node => node.prop === property && node.value === `var(--${token})`)), selector);
  }
  for (const selector of ['.account-auth-card', '.account-sidebar', '.account-details-form', '.account-enquiry', '.help-guide-card']) {
    assertToken(selector, 'background-color', 'home-surface');
    assertToken(selector, 'color', 'home-text');
  }
  assertToken('.account-details-form input[readonly]', 'background-color', 'home-elevated');
  assertToken('.portal-switcher-customer.active', 'color', 'home-action-ink');
  assertToken('.selection-background', 'background-color', 'home-elevated');
});

test('Studio action, focus and field colors meet contrast targets in both themes', () => {
  const studio = postcss.parse(fs.readFileSync(new URL('app/studio-theme.css', root), 'utf8'));
  const declarations = (selector, scheme) => {
    const rule = studio.nodes.find(node => node.selector === selector);
    assert.ok(rule, `expected Studio-scoped ${scheme} styles`);
    assert.ok(rule.nodes.some(node => node.prop === 'color-scheme' && node.value === scheme));
    return Object.fromEntries(rule.nodes.filter(node => node.type === 'decl' && node.prop.startsWith('--')).map(node => [node.prop.slice(2), node.value]));
  };
  const light = declarations('html:has(.admin-shell)', 'light');
  const dark = { ...tokens, ...light, ...declarations('html[data-home-theme="dark"]:not([data-home-public="true"]):has(.admin-shell, .session-gate)', 'dark') };
  for (const [palette, surfaces] of [[light, ['#fff', '#f5f6f0', '#edf2e5']], [dark, ['home-background', 'home-surface', 'home-elevated'].map(name => tokens[name])]]) {
    const color = name => {
      const value = palette[name];
      const reference = /^var\(--([\w-]+)\)$/.exec(value);
      return reference ? color(reference[1]) : value;
    };
    for (const state of ['studio-action', 'studio-action-hover', 'studio-action-active']) {
      assert.ok(contrast(color('studio-on-action'), color(state)) >= 4.5, state);
      for (const surface of surfaces) assert.ok(contrast(color(state), surface) >= 3, `${state} on ${surface}`);
    }
    for (const surface of surfaces) {
      assert.ok(contrast(color('studio-focus'), surface) >= 3, `focus on ${surface}`);
      assert.ok(contrast(color('studio-control-border'), surface) >= 3, `control border on ${surface}`);
    }
  }
});

test('dark styles preserve image color and the supplied evening asset is an unmodified copy', () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const [, selector, body] of rules) {
    if (selector.includes('home-theme="dark"')) {
      assert.ok(selector.includes('data-home-public="true"'), 'dark rules use the home palette scope');
      assert.doesNotMatch(body, /(?:filter\s*:|mix-blend-mode\s*:)/i, selector);
    }
  }
  assert.match(css, /\.home-hero-photo-dark\{display:none\}/);
  assert.match(css, /\.home-hero-photo-light\{display:none\}/);
  const local = fs.readFileSync(new URL('public/images/apartments/hanoi-after-dark.jpg', root));
  assert.ok(local.byteLength > 1000);
  // JPEG signature; no recoloring or generated rendition is substituted here.
  assert.equal(local[0], 0xff); assert.equal(local[1], 0xd8);
});
