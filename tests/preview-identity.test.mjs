import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = ts.transpileModule(fs.readFileSync(new URL('../scripts/vite/sites-vite-plugin.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { sites } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('local preview strips asserted platform identity while preserving application cookies and routing', () => {
  const handlers = [];
  sites({ localPreview: true }).configureServer({ middlewares: { use: handler => handlers.push(handler) } });
  assert.equal(handlers.length, 1);
  const request = {
    url: '/account', method: 'GET',
    headers: {
      'oai-authenticated-user-id': 'asserted-owner',
      'oai-authenticated-user-email': 'asserted@example.invalid',
      cookie: 'application-session=opaque',
      'x-request-id': 'request-123',
    },
    rawHeaders: [
      'OAI-Authenticated-User-Id', 'asserted-owner',
      'oai-authenticated-user-id', 'duplicate-assertion',
      'OAI-Authenticated-User-Email', 'asserted@example.invalid',
      'Cookie', 'application-session=opaque',
      'X-Request-Id', 'request-123',
    ],
  };
  let nextCalls = 0;
  // A frozen response also catches any attempted redirect or cookie mutation.
  handlers[0](request, Object.freeze({}), () => { nextCalls++; });
  assert.equal(nextCalls, 1);
  assert.deepEqual(request.headers, { cookie: 'application-session=opaque', 'x-request-id': 'request-123' });
  assert.deepEqual(request.rawHeaders, ['Cookie', 'application-session=opaque', 'X-Request-Id', 'request-123']);
});

test('hosted execution leaves gateway identity handling outside the local preview plugin', () => {
  for (const plugin of [sites(), sites({ localPreview: false })]) {
    const handlers = [];
    plugin.configureServer({ middlewares: { use: handler => handlers.push(handler) } });
    assert.equal(handlers.length, 0);
  }
});
