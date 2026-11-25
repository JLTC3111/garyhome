import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const images = Array.from({length: 6}, (_, i) => `/photos/${i + 1}.jpg`);
const element = (root, className) => root.findByProps({className});

function loadGallery(carousels, count) {
  const dependencies = {
    'embla-carousel-react': options => {
      const [api] = React.useState(() => {
        const max = Math.max(0, count - (options.axis === 'y' ? 3 : 1));
        let snap = options.startIndex ?? 0;
        const listeners = new Map();
        const api = {
          options, moves: [],
          selectedScrollSnap: () => snap,
          canScrollPrev: () => snap > 0,
          canScrollNext: () => snap < max,
          on(event, listener) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(listener);
            return this;
          },
          off(event, listener) { listeners.get(event)?.delete(listener); return this; },
          emit(event) { listeners.get(event)?.forEach(listener => listener(this)); },
          reInit(next) { snap = next; this.emit('reInit'); },
          scrollTo(next, jump) {
            this.moves.push([next, jump]);
            if (snap === next) return;
            snap = next;
            this.emit('select');
          },
        };
        carousels.push(api);
        return api;
      });
      return [() => {}, api];
    },
    './site-context': {useSite: () => ({t: en => en, language: 'en'})},
    './content-image': {ContentImage: props => React.createElement('img', props)},
    '@/lib/image-metadata': {galleryPhotoMetadata: (_, __, ___, label) => ({alt: label, caption: label})},
    '@/lib/optimized-property-images': {publicPropertyImageSource: photo => photo},
  };
  function load(name) {
    const source = readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), 'utf8');
    const {outputText} = ts.transpileModule(source, {compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    }});
    const module = {exports: {}};
    const dependency = id => id === './embla-carousel-detail-gallery' ? load(id.slice(2)) : dependencies[id] ?? require(id);
    new Function('exports', 'require', 'module', outputText)(module.exports, dependency, module);
    return module.exports;
  }
  return load('property-gallery').PropertyGallery;
}

async function gallery(t, reduce = false) {
  const changes = {
    IS_REACT_ACT_ENVIRONMENT: true,
    window: {matchMedia: query => ({matches: reduce && query.includes('reduced-motion')})},
    document: {body: {style: {overflow: ''}}},
  };
  const previous = Object.fromEntries(Object.keys(changes).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, changes);
  const carousels = [], Gallery = loadGallery(carousels, images.length);
  const dialog = {open: false, showModal() { this.open = true; }, close() { this.open = false; }};
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Gallery, {images, title: 'Test property', verticalRail: true}), {
      createNodeMock: node => node.type === 'dialog' ? dialog : null,
    });
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const button = label => renderer.root.findAllByType('button').find(item => item.props['aria-label'] === label);
  const press = target => act(async () => target.props.onClick({currentTarget: {focus() {}}}));
  const visibleRail = () => renderer.root.findAllByProps({className: 'embla-detail-rail-slide'})
    .filter(item => !item.props.inert).map(item => item.findByType('img').props.src);
  const selected = () => element(renderer.root, 'rental-gallery-main').findAllByProps({className: 'embla-detail-slide'})
    .find(item => !item.props['aria-hidden']).findByType('img').props.src;
  return {renderer, dialog, carousels, rail: carousels.find(api => api.options.axis === 'y'), button, press, visibleRail, selected};
}

test('side, hero, thumbs and viewer share one photo without resetting the rail', async t => {
  const h = await gallery(t);
  const [hero] = h.carousels;
  assert.equal(h.rail.options.slidesToScroll, 1);
  assert.equal(h.rail.options.breakpoints['(max-width: 860px)'].active, false);
  assert.deepEqual(h.visibleRail(), images.slice(1, 3));
  await h.press(h.button('Scroll side photos down'));
  assert.deepEqual(h.visibleRail(), images.slice(2, 4));
  assert.equal(h.selected(), images[0]);

  await h.press(h.button('Show photo 4'));
  assert.equal(h.dialog.open, false);
  assert.equal(h.selected(), images[3]);
  assert.equal(h.button('Open photo 4').props['aria-current'], 'true');
  assert.equal(h.button('Show photo 4').props['aria-pressed'], true);
  assert.equal(h.button('Show photo 4').findByType('img').props.alt, 'Photo 4 of 6');
  assert.deepEqual(h.rail.moves, [[1, false]]);

  await h.press(h.button('Previous gallery photo'));
  assert.equal(h.selected(), images[2]);
  await h.press(element(h.renderer.root, 'button rental-gallery-count'));
  assert.equal(h.dialog.open, true);
  const viewer = h.carousels.at(-1);
  assert.equal(viewer.selectedScrollSnap(), 2);
  await h.press(h.button('Next photo'));
  assert.equal(h.selected(), images[3]);
  await h.press(h.button('Close gallery'));
  assert.equal(h.dialog.open, false);
  assert.equal(h.button('Open photo 4').props['aria-current'], 'true');
  await act(async () => hero.reInit(0));
  assert.equal(hero.selectedScrollSnap(), 3);
  assert.deepEqual(h.rail.moves, [[1, false]]);
});

test('vertical rail clamps a drag to one snap and offers reduced-motion keyboard steps', async t => {
  const h = await gallery(t, true);
  assert.equal(h.rail.options.watchDrag(h.rail, {touches: [{}]}), true);
  assert.equal(h.rail.options.watchDrag(h.rail, {touches: [{}, {}]}), false);
  await act(async () => {
    h.rail.emit('pointerDown');
    h.rail.scrollTo(3, false);
    h.rail.emit('pointerUp');
  });
  assert.deepEqual(h.rail.moves.at(-1), [1, true]);
  assert.deepEqual(h.visibleRail(), images.slice(2, 4));
  const controls = element(h.renderer.root, 'embla-detail-rail-controls');
  await act(async () => controls.props.onKeyDown({key: 'ArrowUp', preventDefault() {}}));
  assert.deepEqual(h.rail.moves.at(-1), [0, true]);
  assert.equal(h.button('Scroll side photos up').props['aria-disabled'], true);
  assert.equal(h.selected(), images[0]);
});

test('one photo fills the hero and a two-photo gallery has one side image without scroll controls', () => {
  const Gallery = loadGallery([], 2);
  const render = count => renderToStaticMarkup(React.createElement(Gallery, {
    images: images.slice(0, count), title: 'Test property', verticalRail: true,
  }));
  const single = render(1), pair = render(2);
  assert.match(single, /rental-gallery-grid" data-single-photo="true"/);
  assert.doesNotMatch(single, /embla-detail-rail-viewport|Previous gallery photo/);
  assert.equal((pair.match(/embla-detail-rail-slide/g) ?? []).length, 1);
  assert.match(pair, /aria-label="Show photo 2"/);
  assert.doesNotMatch(pair, /Scroll side photos (up|down)/);
});
