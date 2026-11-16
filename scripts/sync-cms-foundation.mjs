import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Explicit build-time vendoring: each deployed application owns a pinned copy.
// This script never authenticates, changes databases or publishes a website.
const source = fileURLToPath(new URL('../shared/cms-foundation/', import.meta.url));
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const files = ['index.js', 'index.d.ts', 'content.js', 'copy.js', 'styles.css', 'seo-findings.js', 'seo-findings.d.ts'];
const destinations = [
  path.join(workspace, 'gary_visa_service/website/dist/cms-foundation'),
  path.join(workspace, 'gary_jobs/gary-teaching-jobs/dist/cms-foundation'),
];
const check = process.argv.includes('--check');
const content = await Promise.all(files.map(async name => [name, await readFile(path.join(source, name))]));
const release = createHash('sha256');
for (const [name, body] of content) release.update(name).update(body);
const hash = release.digest('hex');
for (const destination of destinations) {
  if (!check) await mkdir(destination, {recursive: true});
  for (const [name, body] of content) {
    if (check) {
      const deployed = await readFile(path.join(destination, name));
      if (!deployed.equals(body)) throw new Error(`CMS foundation differs: ${destination}/${name}`);
    } else await writeFile(path.join(destination, name), body);
  }
  if (!check) await writeFile(path.join(destination, 'release.json'), JSON.stringify({version: '1.0.0', sha256: hash, source: 'gary-home/shared/cms-foundation', files}, null, 2) + '\n');
  console.log(`${check ? 'Verified' : 'Vendored'} CMS 1.0.0 ${hash.slice(0, 12)}: ${path.relative(workspace, destination)}`);
}
