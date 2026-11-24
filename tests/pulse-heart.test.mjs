import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const source = fs.readFileSync(path.join(root, "components/react-bits/pulse-heart.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "components/react-bits/pulse-heart.css"), "utf8");

function motionNode() {
  const props = {};
  const style = {
    setProperty(name, value) { props[name] = value; },
    removeProperty(name) { delete props[name]; },
    getPropertyValue(name) { return props[name] || ""; },
  };
  Object.defineProperty(style, "transform", {
    get() { return props.transform || ""; },
    set(value) { props.transform = value; },
  });
  return {
    dataset: {},
    style,
    getBoundingClientRect() { return { x: 0, y: 0, width: 39, height: 39, top: 0, left: 0, right: 39, bottom: 39, toJSON() { return this; } }; },
  };
}
function scale(node) {
  const match = /scale\(([^)]+)\)/.exec(node?.style.transform || "");
  return match ? Number(match[1]) : null;
}
function pointer(detail = 1) {
  return { button: 0, detail, stopPropagation() { this.stopped = true; } };
}

function installBrowser(t) {
  const previous = new Map();
  const listeners = new Set();
  const queue = [];
  const media = {
    matches: false,
    addEventListener(_type, callback) { listeners.add(callback); },
    removeEventListener(_type, callback) { listeners.delete(callback); },
  };
  let frame = 0;
  const clock = 10000;
  const now = performance.now.bind(performance);
  const values = {
    IS_REACT_ACT_ENVIRONMENT: true,
    window: { matchMedia: () => media },
    document: { documentElement: { lang: "en" } },
    requestAnimationFrame(callback) { queue.push({ id: ++frame, callback }); return frame; },
    cancelAnimationFrame(id) { const index = queue.findIndex(item => item.id === id); if (index >= 0) queue.splice(index, 1); },
  };
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  performance.now = () => clock;
  const nodes = {};
  const cleanup = { unmount: async () => {} };
  t.after(async () => {
    await cleanup.unmount();
    assert.equal(listeners.size, 0);
    performance.now = now;
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return { cleanup,
    media, listeners, queue, nodes,
    createNodeMock(element) {
      const node = motionNode();
      const className = String(element.props.className || "");
      if (element.type === "button") nodes.button = node;
      if (className.includes("pulse-heart__heart")) nodes.heart = node;
      return node;
    },
    async preferReduced(value) {
      media.matches = value;
      await act(async () => { for (const listener of listeners) listener(); });
    },
  };
}

function load(file, mocks) {
  const cache = new Map();
  function nested(target) {
    if (cache.has(target)) return cache.get(target).exports;
    const loaded = { exports: {} };
    cache.set(target, loaded);
    const code = ts.transpileModule(fs.readFileSync(target, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const dependency = id => {
      if (id.endsWith(".css")) return {};
      if (mocks[id]) return mocks[id];
      if (id.startsWith(".") || id.startsWith("@/")) {
        const base = id.startsWith("@/") ? path.join(root, id.slice(2)) : path.resolve(path.dirname(target), id);
        const match = [base, `${base}.ts`, `${base}.tsx`].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (!match) throw new Error(`Missing ${id}`);
        return nested(match);
      }
      return require(id);
    };
    vm.runInThisContext(`(function(exports,require,module){${code}\n})`, { filename: target })(loaded.exports, dependency, loaded);
    return loaded.exports;
  }
  return nested(file);
}

async function mountHeart(t) {
  const browser = installBrowser(t);
  const PulseHeart = load(path.join(root, "components/react-bits/pulse-heart.tsx"), {}).default;
  const calls = [];
  const mode = { current: "commit" };
  const api = {};
  function Harness() {
    const [liked, setLiked] = React.useState(false);
    const [pending, setPending] = React.useState(false);
    const [disabled, setDisabled] = React.useState(false);
    const [, setTick] = React.useState(0);
    api.setLiked = setLiked;
    api.setPending = setPending;
    api.setDisabled = setDisabled;
    return React.createElement(PulseHeart, {
      liked, pending, disabled: disabled || pending, showCount: false,
      label: liked ? "Remove from favourites" : "Add to favourites",
      icon: filled => React.createElement("svg", { "data-heart": "true", fill: filled ? "currentColor" : "none" }),
      onChange(next) {
        calls.push(next);
        if (mode.current === "commit") setLiked(next);
        else if (mode.current === "hold") setPending(true);
        else setTick(value => value + 1);
      },
    });
  }
  let renderer;
  browser.cleanup.unmount = async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; };
  await act(async () => { renderer = TestRenderer.create(React.createElement(Harness), { createNodeMock: browser.createNodeMock }); });
  const button = () => renderer.root.findByType("button");
  const icon = () => renderer.root.findByType("svg");
  async function at(ms) {
    const frame = browser.queue.shift();
    assert.ok(frame, "animation frame");
    await act(async () => frame.callback(10000 + ms));
  }
  return { ...browser, ...api, calls, mode, button, icon, at };
}

test.describe("homepage favourite pulse", { concurrency: 1 }, () => {
  test("uses the controlled favourite and the existing heart, without a count or React Bits colours", async t => {
    assert.doesNotMatch(source, /hugeicons|pulse-heart__count|ff4d6d|232326|8b8b93|f5f5f5/);
    assert.doesNotMatch(css, /#ff4d6d|#232326|#8b8b93|#f5f5f5|border-radius|width:\s*\d+px|height:\s*\d+px/);
    assert.match(fs.readFileSync(path.join(root, "app/rental.css"), "utf8"), /\.rental-property-card \.save-button\{[^}]*background:#fff;color:var\(--navy\)/);
    assert.match(fs.readFileSync(path.join(root, "app/rental.css"), "utf8"), /\.rental-property-card \.save-button\.is-saved\{color:#a7583d;background:#f4e6dc/);
    assert.match(fs.readFileSync(path.join(root, "app/public-theme.css"), "utf8"), /\.rental-property-card \.save-button\.is-saved/);
    assert.match(fs.readFileSync(path.join(root, "components/home-page.tsx"), "utf8"), /<PropertyCard key=\{p\.id\} property=\{p\} pulseFavourite\b[^>]*\/>/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, "components/homes-page.tsx"), "utf8"), /pulseFavourite/);

    const heart = await mountHeart(t);
    assert.equal(heart.button().props.className.includes("save-button"), true);
    assert.equal(heart.button().props["data-button-variant"], "save");
    assert.equal(heart.button().props["data-no-count"], "");
    assert.equal(heart.button().props["aria-pressed"], false);
    assert.equal(heart.icon().props.fill, "none");
    assert.equal(rendererText(heart.button()), "");
    await act(async () => heart.setLiked(true));
    assert.equal(heart.queue.length, 0);
    assert.equal(heart.button().props["aria-pressed"], true);
    assert.equal(heart.button().props.className.includes("is-saved"), true);
    assert.equal(heart.icon().props.fill, "currentColor");
    assert.equal(heart.button().props.style, undefined);
  });

  test("pointer clicks shrink, flip, rebound and beat, then keyboard and reduced motion settle with the saved state", async t => {
    const heart = await mountHeart(t);
    const down = pointer(1);
    await act(async () => heart.button().props.onPointerDown(down));
    assert.equal(down.stopped, true);
    assert.equal(scale(heart.nodes.button), 0.97);
    const up = pointer(1);
    await act(async () => heart.button().props.onPointerUp(up));
    assert.equal(up.stopped, true);
    assert.equal(scale(heart.nodes.button), null);
    const click = pointer(1);
    await act(async () => heart.button().props.onClick(click));
    assert.equal(click.stopped, true);
    assert.deepEqual(heart.calls, [true]);
    assert.equal(heart.button().props["aria-pressed"], true);
    await act(async () => heart.button().props.onClick(pointer(1)));
    assert.deepEqual(heart.calls, [true]);
    await heart.at(224);
    assert.ok(Math.abs(scale(heart.nodes.heart) - 0.3) < 0.02);
    assert.ok(Math.abs(scale(heart.nodes.button) - 0.97) < 0.02);
    assert.equal(heart.button().props.className.includes("is-saved"), true);
    assert.equal(heart.icon().props.fill, "currentColor");
    await heart.at(420);
    assert.ok(scale(heart.nodes.heart) > 1);
    await heart.at(560);
    assert.equal(scale(heart.nodes.heart), null);
    assert.equal(scale(heart.nodes.button), null);
    assert.equal(heart.queue.length, 0);
    assert.equal(heart.button().props["data-liked"], "true");

    const key = { key: " ", stopPropagation() { key.stopped = true; } };
    await act(async () => { heart.button().props.onKeyDown(key); heart.button().props.onClick(pointer(0)); });
    assert.equal(key.stopped, true);
    assert.deepEqual(heart.calls, [true, false]);
    assert.equal(heart.queue.length, 0);
    assert.equal(heart.button().props["aria-pressed"], false);
    assert.equal(heart.button().props.className.includes("is-saved"), false);
    assert.equal(heart.icon().props.fill, "none");

    await heart.preferReduced(true);
    await act(async () => { heart.button().props.onPointerDown(pointer(1)); heart.button().props.onPointerUp(pointer(1)); heart.button().props.onClick(pointer(1)); });
    assert.deepEqual(heart.calls, [true, false, true]);
    assert.equal(heart.queue.length, 0);
    assert.equal(scale(heart.nodes.button), null);
    assert.equal(heart.button().props["aria-pressed"], true);
    assert.equal(heart.icon().props.fill, "currentColor");
  });

  test("a failed save returns to the confirmed favourite and a successful save keeps it", async t => {
    const heart = await mountHeart(t);
    heart.mode.current = "hold";
    await act(async () => { heart.button().props.onPointerDown(pointer(1)); heart.button().props.onPointerUp(pointer(1)); heart.button().props.onClick(pointer(1)); });
    assert.equal(heart.button().props.disabled, true);
    assert.equal(heart.button().props["aria-pressed"], false);
    assert.equal(heart.button().props["aria-busy"], true);
    await heart.at(224);
    assert.equal(heart.icon().props.fill, "currentColor");
    await heart.at(560);
    assert.equal(heart.button().props.className.includes("is-saved"), true);
    assert.equal(heart.button().props["aria-pressed"], false);
    await act(async () => heart.button().props.onClick(pointer(1)));
    assert.deepEqual(heart.calls, [true]);
    await act(async () => heart.setPending(false));
    assert.equal(heart.button().props.className.includes("is-saved"), false);
    assert.equal(heart.icon().props.fill, "none");
    assert.equal(heart.button().props["aria-pressed"], false);
    assert.equal(heart.button().props.disabled, false);

    heart.mode.current = "reject";
    const rejected = pointer(1);
    await act(async () => { heart.button().props.onPointerDown(rejected); heart.button().props.onClick(rejected); });
    assert.equal(rejected.stopped, true);
    assert.deepEqual(heart.calls, [true, true]);
    assert.equal(heart.queue.length, 0);
    assert.equal(heart.button().props["aria-pressed"], false);
    assert.equal(heart.icon().props.fill, "none");

    heart.mode.current = "hold";
    await act(async () => { heart.button().props.onPointerDown(pointer(1)); heart.button().props.onPointerUp(pointer(1)); heart.button().props.onClick(pointer(1)); });
    await heart.at(560);
    await act(async () => { heart.setLiked(true); heart.setPending(false); });
    assert.equal(heart.button().props["aria-pressed"], true);
    assert.equal(heart.button().props.className.includes("is-saved"), true);
    assert.equal(heart.icon().props.fill, "currentColor");
    assert.equal(heart.queue.length, 0);
  });

  test("homepage cards reuse favourite persistence without opening the listing or moving the photo", async t => {
    const browser = installBrowser(t);
    const saves = [];
    const site = { current: { t: (en, vi) => en, language: "en", currency: "USD", exchangeRate: null, saved: [], pendingSaved: [], toggleSaved(id) { saves.push(id); }, content: { neighbourhoods: [{ slug: "tay-ho", name: "Tây Hồ" }] } } };
    const { PropertyCard } = load(path.join(root, "components/property-card.tsx"), {
      "next/image": { __esModule: true, default: props => React.createElement("img", props) },
      "next/link": { __esModule: true, default: ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children) },
      "next/navigation": { usePathname: () => "/" },
      "./site-context": { useSite: () => site.current },
    });
    const property = {
      id: "home-1", slug: "lake-house", listing_code: "GH-1", title_en: "Lake house", title_vi: "Nhà hồ",
      description_en: "", description_vi: "", district_slug: "tay-ho", address: "Tây Hồ", price: 600, currency: "USD",
      listing_type: "rent", property_type: "Apartment", bedrooms: 2, bathrooms: 1, area_sqm: 80, amenities: [],
      images: ["/images/a.jpg", "/images/b.jpg"], featured: true, status: "published", availability: "available",
      source_url: null, sort_order: 0, created_at: "2026-10-21", updated_at: "2026-10-21",
    };
    let renderer;
    browser.cleanup.unmount = async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; };
    const position = () => renderer.root.findByProps({ className: "rental-photo-position" }).children.join("");
    await act(async () => { renderer = TestRenderer.create(React.createElement(PropertyCard, { property, pulseFavourite: true }), { createNodeMock: browser.createNodeMock }); });
    const favourite = () => renderer.root.findByProps({ "data-button-variant": "save" });
    assert.equal(favourite().props.href, undefined);
    assert.equal(favourite().props.className.includes("pulse-heart"), true);
    assert.equal(favourite().props.className.includes("save-button"), true);
    await act(async () => renderer.root.findByProps({ "aria-label": "Next property photo" }).props.onClick());
    assert.equal(position(), "2 / 2");
    const click = pointer(1);
    await act(async () => { favourite().props.onPointerDown(click); favourite().props.onPointerUp(pointer(1)); favourite().props.onClick(click); });
    assert.equal(click.stopped, true);
    assert.deepEqual(saves, ["home-1"]);
    assert.equal(position(), "2 / 2");
    assert.equal(renderer.root.findAllByType("a").some(link => link.props.href === "/homes/lake-house" || link.props.href === "/en/homes/lake-house"), true);

    site.current = { ...site.current, saved: ["home-1"], pendingSaved: ["home-1"] };
    await act(async () => renderer.update(React.createElement(PropertyCard, { property, pulseFavourite: true })));
    assert.equal(favourite().props["aria-busy"], true);
    assert.equal(favourite().props.disabled, true);
    assert.equal(renderer.root.findAllByProps({ className: "spin" }).length, 0);
    assert.equal(favourite().props["aria-pressed"], true);

    await act(async () => renderer.update(React.createElement(PropertyCard, { property })));
    const plain = renderer.root.findByProps({ "data-button-variant": "save" });
    assert.equal(plain.props.className.includes("pulse-heart"), false);
    assert.equal(plain.props.className.includes("is-saved"), true);
    assert.equal(renderer.root.findAllByProps({ className: "spin" }).length, 1);
  });
});

function rendererText(button) {
  return button.findAllByType("span").flatMap(span => React.Children.toArray(span.props.children)).filter(child => typeof child === "string" || typeof child === "number").join("");
}
