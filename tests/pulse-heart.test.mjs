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
  const timers = new Map(), body = {};
  const portals = [];
  const media = {
    matches: false,
    addEventListener(_type, callback) { listeners.add(callback); },
    removeEventListener(_type, callback) { listeners.delete(callback); },
  };
  let frame = 0, timer = 0;
  const values = {
    IS_REACT_ACT_ENVIRONMENT: true,
    window: {
      matchMedia: () => media,
      setTimeout(callback, delay) { timers.set(++timer, { callback, delay }); return timer; },
      clearTimeout(id) { timers.delete(id); },
    },
    document: { body, documentElement: { lang: "en" } },
    requestAnimationFrame(callback) { queue.push({ id: ++frame, callback }); return frame; },
    cancelAnimationFrame(id) { const index = queue.findIndex(item => item.id === id); if (index >= 0) queue.splice(index, 1); },
  };
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  const nodes = {};
  const cleanup = { unmount: async () => {} };
  t.after(async () => {
    await cleanup.unmount();
    assert.equal(listeners.size, 0);
    assert.equal(queue.length, 0);
    assert.equal(timers.size, 0);
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return { cleanup,
    media, listeners, queue, nodes, timers, body, portals,
    createPortal(children, target) { portals.push(target); return children; },
    createNodeMock(element) {
      const node = motionNode();
      const className = String(element.props.className || "");
      if (element.type === "button") nodes.button = node;
      if (className === "pulse-heart__fanfare") nodes.fanfare = node;
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
  const PulseHeart = load(path.join(root, "components/react-bits/pulse-heart.tsx"), {
    "react-dom": { createPortal: browser.createPortal },
  }).default;
  const calls = [];
  const mode = { current: "commit" };
  const api = {};
  function Harness() {
    const [liked, setLiked] = React.useState(false);
    const [pending, setPending] = React.useState(false);
    const [disabled, setDisabled] = React.useState(false);
    api.setLiked = setLiked;
    api.setPending = setPending;
    api.setDisabled = setDisabled;
    return React.createElement(PulseHeart, {
      liked, pending, disabled: disabled || pending, showCount: false,
      label: liked ? "Remove from favourites" : "Add to favourites",
      icon: filled => React.createElement("svg", { "data-heart": "true", fill: filled ? "currentColor" : "none" }),
      onChange(next) {
        calls.push(next);
        if (mode.current === "hold") {
          setPending(true);
          return new Promise(resolve => {
            api.finish = result => {
              if (typeof result === "boolean") setLiked(result);
              setPending(false);
              resolve(result);
            };
          });
        }
        if (mode.current === "reject") return Promise.reject(new Error("Save failed"));
        setLiked(next);
        return next;
      },
    });
  }
  let renderer;
  browser.cleanup.unmount = async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; };
  await act(async () => { renderer = TestRenderer.create(React.createElement(Harness), { createNodeMock: browser.createNodeMock }); });
  const button = () => renderer.root.findByType("button");
  const icon = () => renderer.root.findByProps({ "data-heart": "true" });
  const fanfare = () => renderer.root.findAllByProps({ className: "pulse-heart__fanfare" });
  const particles = () => renderer.root.findAllByProps({ className: "pulse-heart__particle" });
  async function finishTimer(delay) {
    const [entry] = browser.timers;
    assert.ok(entry, "animation cleanup timer");
    assert.equal(entry[1].delay, delay);
    await act(async () => {
      browser.timers.delete(entry[0]);
      entry[1].callback();
    });
  }
  return { ...browser, ...api, calls, mode, button, icon, fanfare, particles, finishTimer,
    finish: result => api.finish(result),
  };
}

test.describe("homepage favourite pulse", { concurrency: 1 }, () => {
  test("keeps the existing save button chrome and shows passive favourites without fanfare", async t => {
    assert.doesNotMatch(source, /hugeicons|pulse-heart__count/);
    assert.doesNotMatch(css, /\.pulse-heart\s*\{/);
    const buttons = fs.readFileSync(path.join(root, "app/action-buttons.css"), "utf8");
    assert.match(buttons, /--action-green:\s*#168642/);
    assert.match(buttons, /--action-white:\s*#fff/);
    assert.match(buttons, /--action-fill: var\(--action-green\)/);
    assert.match(fs.readFileSync(path.join(root, "components/home-page.tsx"), "utf8"), /<PropertyCard key=\{p\.id\} property=\{p\} pulseFavourite\b[^>]*\/>/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, "components/homes-page.tsx"), "utf8"), /pulseFavourite/);

    const heart = await mountHeart(t);
    assert.equal(heart.button().props.className.includes("save-button"), true);
    assert.equal(heart.button().props["data-button-variant"], "save");
    assert.equal(heart.button().props["data-no-count"], "");
    assert.equal(heart.button().props["aria-pressed"], false);
    assert.equal(heart.icon().props.fill, "none");
    assert.equal(rendererText(heart.button()), "");
    assert.equal(heart.fanfare().length, 0);
    await act(async () => heart.setLiked(true));
    assert.equal(heart.button().props["aria-pressed"], true);
    assert.equal(heart.button().props.className.includes("is-saved"), true);
    assert.equal(heart.icon().props.fill, "currentColor");
    assert.equal(heart.button().props["data-pulse"], undefined);
    assert.equal(heart.fanfare().length, 0);
    assert.equal(heart.timers.size, 0);
    assert.equal(heart.button().props.style, undefined);
  });

  test("only a confirmed addition emits one anchored, staggered fanfare and removal uses a reverse pulse", async t => {
    const heart = await mountHeart(t);
    heart.mode.current = "hold";
    const click = pointer(1);
    await act(async () => {
      heart.button().props.onPointerDown(click);
      assert.equal(scale(heart.nodes.button), 0.97);
      heart.button().props.onPointerUp(pointer(1));
      void heart.button().props.onClick(click);
      void heart.button().props.onClick(pointer(1));
    });
    assert.equal(click.stopped, true);
    assert.deepEqual(heart.calls, [true]);
    assert.equal(heart.button().props["aria-busy"], true);
    assert.equal(heart.icon().props.fill, "none");
    assert.equal(heart.fanfare().length, 0);
    assert.equal(heart.queue.length, 0);

    await act(async () => heart.finish(true));
    assert.equal(heart.button().props["aria-busy"], false);
    assert.equal(heart.button().props["data-pulse"], "add");
    assert.equal(heart.icon().props.fill, "currentColor");
    assert.equal(heart.fanfare()[0].props["aria-hidden"], "true");
    assert.equal(heart.portals.at(-1), heart.body);
    assert.equal(heart.particles().length, 8);
    assert.equal(new Set(heart.particles().map(node => node.props.style["--pulse-heart-angle"])).size, 8);
    assert.equal(heart.particles().filter(node => node.props["data-shape"] === "strip").length, 4);
    assert.deepEqual(
      new Set(heart.particles().map(node => node.props.style.color)),
      new Set(["red", "cyan", "pink", "yellow", "blue", "green"].map(color => "var(--pulse-heart-" + color + ")"))
    );
    assert.ok(heart.particles().some(node => parseFloat(node.props.style["--pulse-heart-delay"]) > 0));
    assert.equal(heart.nodes.fanfare.style.transform, "translate3d(19.5px,19.5px,0)");
    assert.equal(heart.nodes.fanfare.style.getPropertyValue("--pulse-heart-radius"), "24.5px");
    heart.nodes.button.getBoundingClientRect = () => ({ left: 25, top: 40, width: 39, height: 39 });
    await act(async () => heart.queue.shift().callback());
    assert.equal(heart.nodes.fanfare.style.transform, "translate3d(44.5px,59.5px,0)");
    await act(async () => heart.button().props.onClick(pointer(1)));
    assert.deepEqual(heart.calls, [true]);
    await heart.finishTimer(560);
    assert.equal(heart.fanfare().length, 0);
    assert.equal(heart.queue.length, 0);

    heart.mode.current = "commit";
    const key = { key: " ", stopPropagation() { key.stopped = true; } };
    await act(async () => { heart.button().props.onKeyDown(key); await heart.button().props.onClick(pointer(0)); });
    assert.equal(key.stopped, true);
    assert.deepEqual(heart.calls, [true, false]);
    assert.equal(heart.button().props["data-pulse"], "remove");
    assert.equal(heart.icon().props.fill, "none");
    assert.equal(heart.fanfare().length, 0);
    await heart.finishTimer(210);
  });

  test("failed saves and reduced motion keep the controlled heart readable and skip fanfare", async t => {
    const heart = await mountHeart(t);
    heart.mode.current = "hold";
    await act(async () => { void heart.button().props.onClick(pointer(1)); });
    await act(async () => heart.finish(null));
    assert.equal(heart.button().props.disabled, false);
    assert.equal(heart.button().props["aria-pressed"], false);
    assert.equal(heart.icon().props.fill, "none");
    assert.equal(heart.fanfare().length, 0);

    heart.mode.current = "reject";
    await act(async () => heart.button().props.onClick(pointer(0)));
    assert.deepEqual(heart.calls, [true, true]);
    assert.equal(heart.button().props["data-pulse"], undefined);
    assert.equal(heart.timers.size, 0);

    heart.mode.current = "commit";
    await heart.preferReduced(true);
    await act(async () => heart.button().props.onClick(pointer(0)));
    assert.equal(heart.icon().props.fill, "currentColor");
    assert.equal(heart.fanfare().length, 0);
    assert.equal(heart.timers.size, 0);
    await heart.preferReduced(false);
    assert.equal(heart.fanfare().length, 0, "a preference change does not replay a save");

    await act(async () => heart.button().props.onClick(pointer(0)));
    await heart.finishTimer(210);
    await act(async () => heart.button().props.onClick(pointer(0)));
    assert.equal(heart.fanfare().length, 1);
    await heart.preferReduced(true);
    assert.equal(heart.fanfare().length, 0);
    assert.equal(heart.timers.size, 0);
    assert.equal(heart.queue.length, 0);

    assert.match(css, /html\[data-home-theme="dark"\] \.pulse-heart__fanfare/);
    assert.match(css, /\.pulse-heart__fanfare\s*\{[^}]*position: fixed;[^}]*pointer-events: none;/);
    assert.match(css, /pulse-heart-scatter 470ms[^;]+var\(--pulse-heart-delay\)/);
    assert.match(css, /prefers-reduced-motion: reduce/);
  });

  test("homepage and filtered cards share thumbnails and keep the favourite action separate", async t => {
    const browser = installBrowser(t);
    const saves = [];
    const site = { current: { t: (en, vi) => en, language: "en", currency: "USD", exchangeRate: null, saved: [], pendingSaved: [], toggleSaved(id) { saves.push(id); }, content: { neighbourhoods: [{ slug: "tay-ho", name: "Tây Hồ" }] } } };
    const { PropertyCard } = load(path.join(root, "components/property-card.tsx"), {
      "next/image": { __esModule: true, default: props => React.createElement("img", props) },
      "next/link": { __esModule: true, default: ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children) },
      "next/navigation": { usePathname: () => "/" },
      "./site-context": { useSite: () => site.current },
      "embla-carousel-react": () => {
        const [api] = React.useState(() => {
          const listeners = new Map();
          let index = 0;
          return {
            on(event, handler) { listeners.set(event, handler); return this; },
            off(event) { listeners.delete(event); return this; },
            selectedScrollSnap: () => index,
            scrollTo(next) { index = next; listeners.get("select")?.(); },
          };
        });
        return [() => {}, api];
      },
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
    const thumbnails = () => renderer.root.findByProps({ className: "embla-listing-thumbnails" }).findAllByType("button");
    assert.equal(thumbnails().length, 2);
    assert.equal(favourite().props.href, undefined);
    assert.equal(favourite().props.className.includes("pulse-heart"), true);
    assert.equal(favourite().props.className.includes("save-button"), true);
    await act(async () => renderer.root.findByProps({ "aria-label": "Next property photo" }).props.onClick());
    assert.equal(position(), "2 / 2");
    assert.equal(thumbnails()[1].props["aria-pressed"], true);
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

    await act(async () => renderer.update(React.createElement(PropertyCard, { property, keywordTerms: ["lake"] })));
    const plain = renderer.root.findByProps({ "data-button-variant": "save" });
    assert.equal(plain.props.className.includes("pulse-heart"), false);
    assert.equal(plain.props.className.includes("is-saved"), true);
    assert.equal(renderer.root.findAllByProps({ className: "spin" }).length, 1);
    assert.equal(renderer.root.findByType("mark").children.join(""), "Lake");
    await act(async () => thumbnails()[0].props.onClick());
    assert.equal(position(), "1 / 2");
    assert.equal(thumbnails()[0].props["aria-pressed"], true);

    await act(async () => renderer.update(React.createElement(PropertyCard, { property: { ...property, images: property.images.slice(0, 1) } })));
    assert.equal(renderer.root.findAllByProps({ className: "embla-listing-thumbnails" }).length, 0);
    assert.equal(renderer.root.findAllByProps({ className: "rental-card-photo-nav" }).length, 0);
    assert.equal(renderer.root.findAllByProps({ className: "rental-photo-position" }).length, 0);
    assert.equal(renderer.root.findByType("img").props.loading, "lazy");
    assert.equal(renderer.root.findByProps({ "data-button-variant": "save" }).props["aria-pressed"], true);
  });
});

function rendererText(button) {
  return button.findAllByType("span").flatMap(span => React.Children.toArray(span.props.children)).filter(child => typeof child === "string" || typeof child === "number").join("");
}
