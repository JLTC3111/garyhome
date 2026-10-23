import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const base = path.resolve(import.meta.dirname, '..');
function runtime(platform, values = {}, nodeFallback = {}) {
  const calls = [], modules = new Map();
  const process = { env: platform === 'node' ? values : nodeFallback };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative).exports;
    const loadedModule = { exports: {} }; modules.set(relative, loadedModule);
    const source = ts.transpileModule(fs.readFileSync(path.join(base, relative), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const dependency = id => {
      if (id === 'cloudflare:workers') return { env: values };
      if (id === './runtime-env') return load(platform === 'node' ? 'lib/runtime-env.ts' : 'lib/runtime-env.cloudflare.ts');
      if (id === '@/lib/server') return load('lib/server.ts');
      if (id === '@supabase/supabase-js') return { createClient(url, key, options) { const client = { url, key, options }; calls.push(client); return client; } };
      if (id === './seed') return { seed: {} };
      if (id === './requests') return { fetchWithDeadline() { throw new Error('No external requests in runtime configuration checks.'); } };
      if (id === './public-content') return { ContentReadError: class extends Error {} };
      throw new Error('Unexpected runtime dependency: ' + id);
    };
    vm.runInNewContext('(function(exports,require,module,process){' + source + '\n})', { Response, console }, { filename: relative })(loadedModule.exports, dependency, loadedModule, process);
    return loadedModule.exports;
  }
  return { server: load('lib/server.ts'), config: load('app/api/config/route.ts'), calls };
}

for (const platform of ['node', 'cloudflare']) test(`${platform} runtime reads Supabase settings and exposes only public configuration`, async () => {
  const values = { SUPABASE_URL: 'https://project.example.invalid', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_server_test' };
  const h = runtime(platform, values, { SUPABASE_URL: 'https://wrong.example.invalid', SUPABASE_SECRET_KEY: 'wrong-server-key' });
  const response = await h.config.GET(), body = await response.json();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(body, { url: values.SUPABASE_URL, publishableKey: values.SUPABASE_PUBLISHABLE_KEY, configured: true });
  assert.equal(h.calls.length, 0, 'Public configuration must not construct an admin client.');
  const customer = h.server.publicSupabase('customer-session');
  assert.equal(customer.key, values.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(customer.options.global.headers.Authorization, 'Bearer customer-session');
  assert.equal(customer.options.auth.persistSession, false);
  const admin = h.server.staffAdminClient();
  assert.equal(admin.key, values.SUPABASE_SECRET_KEY); assert.equal(admin.url, values.SUPABASE_URL);
  assert.equal(admin.options.auth.persistSession, false); assert.equal(admin.options.auth.detectSessionInUrl, false);
  assert.ok(!JSON.stringify(body).includes(values.SUPABASE_SECRET_KEY));
});

test('an incomplete Node deployment stays unconfigured without constructing Supabase clients', async () => {
  const h = runtime('node', { SUPABASE_SECRET_KEY: 'server-key-with-no-project-url' });
  assert.equal((await (await h.config.GET()).json()).configured, false);
  assert.equal(h.server.publicSupabase(), null); assert.equal(h.server.staffAdminClient(), null);
  assert.equal(h.calls.length, 0);
});
