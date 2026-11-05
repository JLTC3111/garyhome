import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_STAFF_AUTHOR, defaultListingAuthorId, resolveListingAuthor } from '../lib/listing-author-default.ts';
const user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},staffProfile={display_name:'Assigned Staff'};
const profile=(changes={})=>({id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',staff_user_id:user.id,display_name:'Existing staff',published:false,sort_order:0,...changes});
function backend(reads=[],write={data:null,error:null}) {
 const calls=[];return {calls,editorTask:async run=>run({from(table){const call={table,filters:{}};calls.push(call);const query={select(){return query;},eq(key,value){call.filters[key]=value;return query;},order(){return query;},limit(){return query;},abortSignal(){return query;},maybeSingle:async()=>reads.shift()||{data:null,error:null},insert(value){call.insert=value;return query;},single:async()=>write.data==='inserted'?{data:call.insert,error:null}:write};return query;}},new AbortController().signal)};
}
test('new listings default to the signed-in linked profile, or automatic own profile, while guests use company contact',()=>{
 assert.equal(defaultListingAuthorId([],null),null);assert.equal(defaultListingAuthorId([],user.id),CURRENT_STAFF_AUTHOR);
 assert.equal(defaultListingAuthorId([profile(),profile({id:'published',published:true})],user.id),'published');
});
test('explicit company and another author choices never create or replace profiles',async()=>{
 const db=backend();for(const authorId of [null,'another-profile'])assert.deepEqual(await resolveListingAuthor({authorId,authors:[],user,staffProfile,demo:false,...db}),{authorId});assert.equal(db.calls.length,0);
});
test('a stale draft profile is reused without publishing or overwriting its approved details',async()=>{
 const author=profile(),db=backend([{data:author,error:null}]);const result=await resolveListingAuthor({authorId:CURRENT_STAFF_AUTHOR,authors:[],user,staffProfile,demo:false,...db});assert.equal(result.author,author);assert.equal(result.author.published,false);assert.equal(db.calls.length,1);assert.deepEqual(db.calls[0].filters,{staff_user_id:user.id});
});
test('first save creates one staff-linked profile without publishing private contact details',async()=>{
 const db=backend([],{data:'inserted'}),result=await resolveListingAuthor({authorId:CURRENT_STAFF_AUTHOR,authors:[],user,staffProfile,demo:false,...db});assert.equal(result.authorId,user.id);assert.equal(result.author.display_name,staffProfile.display_name);assert.equal(result.author.staff_user_id,user.id);assert.equal(result.author.published,true);for(const key of ['email','phone','whatsapp_phone','zalo_phone'])assert.equal(result.author[key],'');assert.equal(db.calls.filter(call=>call.insert).length,1);
});
test('concurrent profile creation recovers the already saved linked profile',async()=>{
 const saved=profile({id:user.id,published:true}),db=backend([{data:null,error:null},{data:saved,error:null}],{error:{code:'23505'},data:null});const result=await resolveListingAuthor({authorId:CURRENT_STAFF_AUTHOR,authors:[],user,staffProfile,demo:false,...db});assert.equal(result.authorId,user.id);assert.equal(db.calls.length,3);
});

test('a profile still loading at first save is fetched before creating the named author',async()=>{
 const db=backend([],{data:'inserted'}),original=db.editorTask;
 db.editorTask=run=>original((client,signal)=>run({...client,rpc(name){assert.equal(name,'get_staff_profile');return {abortSignal:async()=>({data:{display_name:'Actual signed-in staff'},error:null})};}},signal));
 const result=await resolveListingAuthor({authorId:CURRENT_STAFF_AUTHOR,authors:[],user,staffProfile:null,demo:false,...db});
 assert.equal(result.author.display_name,'Actual signed-in staff');
});
