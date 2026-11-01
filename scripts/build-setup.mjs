import { readFile, readdir, writeFile } from 'node:fs/promises';
const root = new URL('../supabase/', import.meta.url);
const files = (await readdir(new URL('migrations/', root))).filter(name => name.endsWith('.sql')).sort();
const migrations = await Promise.all(files.map(name => readFile(new URL('migrations/' + name, root), 'utf8')));
const seed = await readFile(new URL('seed.sql', root), 'utf8');
// Later migrations backfill rental details, authors and publication safeguards
// on these reference rows. Seed at the documented original-schema stage.
const seedAfter = files.indexOf('20261021201948_customer_portal.sql');
if (seedAfter < 0) throw new Error('The initial customer schema migration is missing.');
const sections = migrations.flatMap((sql, index) => {
  const section = '-- Migration: ' + files[index] + '\n' + sql;
  return index === seedAfter ? [section, seed] : [section];
});
const output = ('-- Fresh projects only. Existing projects should apply individual migrations.\n' + sections.join('\n')).trimEnd() + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(new URL('setup.sql', root), 'utf8') !== output) throw new Error('setup.sql is stale. Run node scripts/build-setup.mjs.');
} else await writeFile(new URL('setup.sql', root), output);
console.log('Prepared fresh setup from ' + files.length + ' migrations and the seed.');
