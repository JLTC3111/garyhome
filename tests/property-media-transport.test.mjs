import test from 'node:test';
import assert from 'node:assert/strict';
import {storageStages} from '../scripts/property-media-migration-transport.mjs';
import {homeOwnerSession} from '../scripts/property-media-session.mjs';
import {digest} from '../scripts/plan-property-image-optimization.mjs';

const bytes=Buffer.from('file contents'), key='properties/Room (3).jpg';
const identity={key,bytes:bytes.length,mime:'image/jpeg',etag:'"tag"',sha256:digest(bytes)};
const options={key:'sb_publishable_fixture',token:'owner-fixture'};

test('Storage transport uses create-only writes, checks backup bytes and strips credentials from public reads',async()=>{
 const requests=[];
 const client=storageStages({...options,fetcher:async (url,init)=>{
  requests.push({url:new URL(url),init});
  if(init.method==='POST')return Response.json({Key:key});
  return new Response(bytes,{headers:{'content-type':identity.mime,'content-length':String(bytes.length),etag:'tag'}});
 }});
 assert.deepEqual(await client.read(identity),bytes);
 assert.deepEqual(await client.read(identity,true),bytes);
 await client.upload(key,bytes,identity.mime,{original_filename:'Room (3).jpg'});
 assert.match(requests[0].url.pathname,/\/object\/property-media\/properties\/Room%20\(3\).jpg$/);
 assert.ok(requests[0].url.searchParams.has('cacheNonce'));
 assert.equal(requests[0].init.redirect,'error');
 assert.equal(requests[0].init.headers.authorization,'Bearer owner-fixture');
 assert.equal(requests[1].init.headers.authorization,undefined);
 assert.match(requests[1].url.pathname,/\/object\/public\/property-media\//);
 assert.equal(requests[2].init.headers['x-upsert'],'false');
 assert.equal(requests[2].init.headers['content-type'],identity.mime);
 assert.deepEqual(JSON.parse(Buffer.from(requests[2].init.headers['x-metadata'],'base64')), {original_filename:'Room (3).jpg'});
 await assert.rejects(client.read({...identity,sha256:'0'.repeat(64)}),/SHA-256/);
});

test('Storage transport rejects privileged keys, redirect paths and mismatched response identities',async()=>{
 assert.throws(()=>storageStages({...options,key:'sb_secret_fixture'}),/publishable/);
 const client=storageStages({...options,fetcher:async()=>new Response(bytes,{headers:{'content-type':identity.mime,etag:'different'}})});
 assert.throws(()=>client.read({...identity,key:'folder/../other.jpg'}),/Invalid Storage key/);
 await assert.rejects(client.read(identity),/audited size, MIME or ETag/);
});

test('interactive sign-in uses the configured Home project and stops on rejection without printing credentials',async()=>{
 const env={PGSERVICE:'gary-home-media'};
 const response=()=>Response.json({configured:true,url:'https://duyiihsmaqfgwezmsnjs.supabase.co',publishableKey:options.key});
 const prompt=label=>label.endsWith('email')?' OWNER@example.test ':'fixture-pass';
 const requests=[];
 const login=await homeOwnerSession({env,prompt,fetcher:async(url,init)=>{
  requests.push({url,init});
  if(requests.length===1)return response();
  return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600});
 }});
 assert.equal(typeof (await login()).owner,'function');
 assert.deepEqual(Object.keys(env),['PGSERVICE']);
 assert.equal(requests[1].url,'https://duyiihsmaqfgwezmsnjs.supabase.co/auth/v1/token?grant_type=password');
 assert.equal(requests[1].init.redirect,'error');
 assert.deepEqual(JSON.parse(requests[1].init.body),{email:'owner@example.test',password:'fixture-pass'});
 let failedAttempts=0;
 await assert.rejects(homeOwnerSession({env:{...env,GARY_MEDIA_PUBLISHABLE_KEY:options.key},prompt,fetcher:async()=>{
  failedAttempts++;
  return Response.json({message:'fixture-pass'},{status:401});
 }}),{message:'Home Owner sign-in returned HTTP 401.'});
 assert.equal(failedAttempts,1);
 await assert.rejects(homeOwnerSession({env,prompt:()=>assert.fail('Unexpected prompt'),fetcher:async()=>
   Response.json({configured:true,url:'https://other.example.test',publishableKey:options.key})}),/audited project/);
});
