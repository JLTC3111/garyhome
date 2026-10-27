import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const {packages}=JSON.parse(fs.readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
test('every locked package has a version, including optional packages for other platforms',()=>{
 for(const [location,record]of Object.entries(packages)){
  if(!location||record.link)continue;
  assert.equal(typeof record.version,'string',location+' is missing its version');
  assert.match(record.version,/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,location+' has an invalid version');
 }
});
test('locked package dependencies resolve even in platform-specific optional branches',()=>{
 function resolve(location,name){
  let cursor=location;
  for(;;){
   const key=(cursor?cursor+'/':'')+'node_modules/'+name;
   if(packages[key])return packages[key];
   if(!cursor)return null;
   const parent=path.posix.dirname(cursor);cursor=parent==='.'?'':parent;
  }
 }
 for(const [location,record]of Object.entries(packages))for(const name of Object.keys(record.dependencies||{})){
  assert.ok(resolve(location,name),location+' cannot resolve '+name+' in package-lock.json');
 }
});
