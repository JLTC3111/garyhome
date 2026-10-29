import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const root = new URL('../', import.meta.url);
const output = new URL('public/shared/gary-apps/v1/', root);
const [bundle, css] = await Promise.all([
  build({
    absWorkingDir: fileURLToPath(root),
    entryPoints: ['shared/gary-apps/runtime.tsx'],
    bundle: true, write: false, format: 'esm', platform: 'browser',
    target: ['es2020'], minify: true, legalComments: 'inline',
    define: { 'process.env.NODE_ENV': '"production"' },
  }),
  readFile(new URL('shared/gary-apps/styles.css', root), 'utf8'),
]);
const js = bundle.outputFiles[0].contents;
const release = createHash('sha256').update(js).update(css).digest('hex').slice(0, 16);
// Load a release's presentation before mounting it without restyling an open
// menu from the previous release or any unrelated part of the host page.
const scoped = postcss.parse(css);
scoped.walkRules(rule => {
  rule.selectors = rule.selectors.map(selector => {
    const scope = `:where([data-gary-apps-runtime="${release}"] *)`;
    const pseudoElement = selector.search(/::[\w-]+(?:\([^)]*\))?$/);
    return pseudoElement < 0 ? selector + scope : selector.slice(0, pseudoElement) + scope + selector.slice(pseudoElement);
  });
});
await mkdir(output, { recursive: true });
// Keep earlier hashed releases: clients can finish in-flight loads during a publish.
await Promise.all([
  writeFile(new URL(`runtime.${release}.js`, output), js),
  writeFile(new URL(`styles.${release}.css`, output), scoped.toString()),
]);
// Write the release pointer only after both matching assets exist.
await writeFile(new URL('manifest.json', output), JSON.stringify({
  schemaVersion: 1, release,
  module: `./runtime.${release}.js`, stylesheet: `./styles.${release}.css`,
}, null, 2) + '\n');
console.log(`Gary Apps v1: ${release} (${Math.round(js.length / 1024)} kB JS)`);
