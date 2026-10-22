import { readFile, readdir, writeFile } from 'node:fs/promises';
const root = new URL('../supabase/', import.meta.url);
const files = (await readdir(new URL('migrations/', root))).filter(name => name.endsWith('.sql')).sort();
const migrations = await Promise.all(files.map(name => readFile(new URL('migrations/' + name, root), 'utf8')));
const seed = await readFile(new URL('seed.sql', root), 'utf8');
await writeFile(new URL('setup.sql', root), '-- Fresh projects only. Existing projects should apply individual migrations.\n' + migrations.join('\n') + '\n' + seed);
console.log('Prepared fresh setup from ' + files.length + ' migrations and the seed.');
