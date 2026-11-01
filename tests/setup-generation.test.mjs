import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('the committed fresh setup is synchronized with every migration and seed',()=>{
 const result=spawnSync(process.execPath,['scripts/build-setup.mjs','--check'],{
  cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',
 });
 assert.equal(result.status,0,result.stderr||result.stdout);
});
