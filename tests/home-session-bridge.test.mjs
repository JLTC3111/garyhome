import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MessageChannel } from 'node:worker_threads';
import { runInNewContext } from 'node:vm';
import { createClient } from '@supabase/supabase-js';
import ts from 'typescript';
import { homeAuthStorageKey, staffSessionStorage, watchHomeSessionStorage } from '../lib/home-session-bridge.ts';
import { CANONICAL_SITE_ORIGIN as home, STAFF_PORTAL_ORIGIN as staff } from '../lib/site-origin.ts';

const backendUrl = 'https://gary-home-test.supabase.invalid';
const key = homeAuthStorageKey(backendUrl);
const frameScript = readFileSync(new URL('../public/gary-home-session-bridge.js', import.meta.url), 'utf8');
const fixtureSession = id => JSON.stringify({ user: { id }, access_token: 'fixture-access', refresh_token: 'fixture-refresh' });

function dispatch(target, type, properties) {
  target.dispatchEvent(Object.assign(new Event(type), properties));
}

function bridgeHarness(t, { local, shared, blocked = false } = {}) {
  const channels = [];
  const localValues = new Map(local ? [[key, local]] : []);
  const sharedValues = new Map(shared ? [[key, shared]] : []);
  const storage = values => ({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  });
  const host = Object.assign(new EventTarget(), { location: new URL(staff + '/admin'), localStorage: storage(localValues) });
  host.top = host;
  const frameWindow = Object.assign(new EventTarget(), { parent: host });
  const sharedStorage = storage(sharedValues);
  Object.defineProperty(frameWindow, 'localStorage', { get() {
    if (blocked) throw new Error('Blocked by browser');
    return sharedStorage;
  } });
  const message = (data, ports, origin = staff, source = host) => dispatch(frameWindow, 'message', { data, ports, origin, source });
  runInNewContext(frameScript, {
    window: frameWindow,
    location: { origin: home },
    document: { currentScript: { dataset: { origin: home, parent: staff, key } } },
  });
  const frame = new EventTarget();
  frame.setAttribute = (name, value) => { frame[name] = value; };
  frame.remove = () => { frame.removed = true; };
  frame.contentWindow = { postMessage(data, target, ports) {
    assert.equal(target, home);
    message(data, ports);
  } };
  const document = Object.assign(new EventTarget(), {
    createElement: tag => { assert.equal(tag, 'iframe'); return frame; },
    body: { appendChild(node) { dispatch(node, 'load', {}); } },
  });
  const originals = new Map();
  for (const [name, value] of Object.entries({ window: host, document, MessageChannel: function () {
    const channel = new MessageChannel();
    channels.push(channel);
    return channel;
  } })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  t.after(() => {
    for (const channel of channels) { channel.port1.close(); channel.port2.close(); }
    for (const [name, value] of originals) {
      if (value) Object.defineProperty(globalThis, name, value);
      else delete globalThis[name];
    }
  });
  return { host, localValues, sharedValues, frame, message, externalChange() {
    dispatch(frameWindow, 'storage', { key, storageArea: sharedStorage });
  } };
}

test('the session frame accepts only the configured project and exact staff parent', async t => {
  const h = bridgeHarness(t, { shared: fixtureSession('owner') });
  const hello = { type: 'gary-home-session-v1', storageKey: key };
  const refused = { postMessage() { assert.fail('An untrusted port was accepted'); } };
  h.message(hello, [refused], 'https://jobs.garyhome.vn');
  h.message(hello, [refused], staff, {});
  h.message({ ...hello, storageKey: 'unrelated-key' }, [refused]);
  const storage = await staffSessionStorage(key);
  assert.equal(h.frame.src, home + '/api/auth/session-bridge');
  assert.equal(h.frame.sandbox, 'allow-scripts allow-same-origin');
  assert.equal(await storage.getItem(key), fixtureSession('owner'));
});

test('both hosts read one current session and staff receives changes to the public store', async t => {
  const h = bridgeHarness(t, { shared: fixtureSession('owner') });
  const storage = await staffSessionStorage(key);
  await storage.setItem(key, fixtureSession('owner-refreshed'));
  assert.equal(h.sharedValues.get(key), fixtureSession('owner-refreshed'));
  assert.equal(h.localValues.has(key), false);
  await storage.setItem(key + '-code-verifier', 'fixture-verifier');
  assert.equal(h.localValues.get(key + '-code-verifier'), 'fixture-verifier');
  assert.equal(h.sharedValues.size, 1);

  const changed = new Promise(resolve => {
    const unsubscribe = watchHomeSessionStorage(backendUrl, () => { unsubscribe(); resolve(); });
  });
  h.sharedValues.delete(key);
  h.externalChange();
  await changed;
  assert.equal(await storage.getItem(key), null);
  await storage.setItem(key, fixtureSession('owner'));
  await storage.removeItem(key);
  assert.equal(h.sharedValues.has(key), false);
});

test('the installed Supabase client restores the shared session on the staff host', async t => {
  const session = { ...JSON.parse(fixtureSession('owner')), expires_at: Math.floor(Date.now()/1000) + 3600 };
  bridgeHarness(t, { shared: JSON.stringify(session) });
  const auth = createClient(backendUrl, 'fixture-key', {
    auth: { storageKey: key, storage: await staffSessionStorage(key), autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: () => assert.fail('An active stored session should not need another sign-in') },
  }).auth;
  try {
    const restored = await auth.getSession();
    assert.equal(restored.error, null);
    assert.equal(restored.data.session?.user.id, 'owner');
  } finally { await auth.dispose(); }
});

test('legacy staff sessions move to the public store and leave one copy', async t => {
  const session = fixtureSession('existing-staff');
  const h = bridgeHarness(t, { local: session });
  const storage = await staffSessionStorage(key);
  assert.equal(await storage.getItem(key), session);
  assert.equal(h.sharedValues.get(key), session);
  assert.equal(h.localValues.has(key), false);
});

test('initialization leaves different existing accounts separate', async t => {
  const local = fixtureSession('editor'), shared = fixtureSession('customer');
  const h = bridgeHarness(t, { local, shared });
  assert.equal(await staffSessionStorage(key), undefined);
  assert.equal(h.frame.removed, true);
  assert.equal(h.localValues.get(key), local);
  assert.equal(h.sharedValues.get(key), shared);
});

test('a browser that blocks embedded storage keeps its existing local session', async t => {
  const local = fixtureSession('editor');
  const h = bridgeHarness(t, { local, blocked: true });
  assert.equal(await staffSessionStorage(key), undefined);
  assert.equal(h.localValues.get(key), local);
  assert.equal(h.frame.removed, true);
});

test('session bridge HTML is noncacheable and only frameable by the staff origin', async () => {
  const file = new URL('../app/api/auth/session-bridge/route.ts', import.meta.url);
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const exports = {};
  runInNewContext(source, { exports, Response, URL, require: id => ({
    '@/lib/home-session-bridge': { homeAuthStorageKey },
    '@/lib/server': { backendConfig: () => ({ url: backendUrl, key: 'fixture-publishable-key' }) },
    '@/lib/site-origin': { CANONICAL_SITE_ORIGIN: home, STAFF_PORTAL_ORIGIN: staff },
  })[id] });
  const response = exports.GET(new Request(home + '/api/auth/session-bridge'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors https:\/\/staff\.garyhome\.vn;/);
  const html = await response.text();
  assert.match(html, /data-key="sb-gary-home-test-auth-token"/);
  assert.doesNotMatch(html, /fixture-publishable-key/);
  for (const origin of [staff, 'https://jobs.garyhome.vn', 'http://www.garyhome.vn', 'http://localhost:3000']) {
    assert.equal(exports.GET(new Request(origin + '/api/auth/session-bridge')).status, 404);
  }
});
