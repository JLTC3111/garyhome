import test from 'node:test';import assert from 'node:assert/strict';
import {canViewTeam,canViewRole,canManageRole,canManageStaff} from '../lib/staff.ts';
test('role visibility is inclusive while management stays strictly below the actor',()=>{
 const levels={owner:4,admin:3,manager:2,editor:1};
 for(const [actor,actorRank] of Object.entries(levels))for(const [target,targetRank] of Object.entries(levels)){
  assert.equal(canViewRole(actor,target),targetRank<=actorRank,actor+' views '+target);
  assert.equal(canManageRole(actor,target),targetRank<actorRank,actor+' manages '+target);
 }
 for(const value of [undefined,null,'','customer','staff','OWNER',0,{},true]){assert.equal(canViewTeam(value),false);assert.equal(canViewRole(value,'editor'),false);assert.equal(canViewRole('owner',value),false);}
 assert.equal(canViewTeam('editor'),true);assert.equal(canManageStaff('editor'),false);
});
