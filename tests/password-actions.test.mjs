import test from 'node:test';
import assert from 'node:assert/strict';
import { emailLinkIdentity, emailLinkIssue, emailTokenLink, setAccountPassword } from '../lib/password-actions.ts';

const session=id=>({user:{id},access_token:'token-for-'+id});
test('password forms bind to the subject of the matching email link, and malformed links grant no form identity',()=>{
 const jwt='header.'+Buffer.from(JSON.stringify({sub:'invited-staff'})).toString('base64url')+'.signature';
 assert.equal(emailLinkIdentity('#type=invite&access_token='+jwt,'invite'),'invited-staff');
 for(const hash of ['','#type=invite','#type=invite&access_token=invalid','#type=recovery&access_token='+jwt])assert.equal(emailLinkIdentity(hash,'invite'),null);
});
test('password setup freezes the intended identity even if the SDK account changes during configuration loading',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 let current=session('invited-staff'),headers;
 const client={auth:{getSession:async()=>({data:{session:current},error:null})}};
 globalThis.fetch=async(input,init)=>{
  if(input==='/api/config'){
   current=session('other-account');return Response.json({configured:true,url:'https://unit-test.invalid',publishableKey:'sb_publishable_test'});
  }
  assert.equal(input,'https://unit-test.invalid/auth/v1/user');assert.equal(init.method,'PUT');
  headers=new Headers(init.headers);assert.deepEqual(JSON.parse(init.body),{password:'A long private password'});return Response.json({id:'invited-staff'});
 };
 await setAccountPassword(client,'invited-staff','A long private password',new AbortController().signal);
 assert.equal(headers.get('authorization'),'Bearer token-for-invited-staff');assert.equal(headers.get('apikey'),'sb_publishable_test');
});
test('a mismatched identity never sends any password request',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let requests=0;
 globalThis.fetch=async()=>{requests++;return Response.json({});};
 const client={auth:{getSession:async()=>({data:{session:session('other-account')},error:null})}};
 await assert.rejects(setAccountPassword(client,'intended-account','A long password',new AbortController().signal),/account changed/);
 assert.equal(requests,0);
});
test('expired email links fail without treating a password update as successful',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async input=>input==='/api/config'?Response.json({configured:true,url:'https://unit-test.invalid',publishableKey:'sb_publishable_test'}):Response.json({error:'Expired'},{status:401});
 const client={auth:{getSession:async()=>({data:{session:session('intended-account')},error:null})}};
 await assert.rejects(setAccountPassword(client,'intended-account','A long password',new AbortController().signal),/link has expired/);
});


test('email callback errors are classified without displaying untrusted descriptions',()=>{
 assert.equal(emailLinkIssue('#error=access_denied&error_code=otp_expired&error_description=anything'),'expired');
 assert.equal(emailLinkIssue('', '?error_code=otp_expired'),'expired');
 assert.equal(emailLinkIssue('#error_description=<script>'),'invalid');assert.equal(emailLinkIssue(''),null);
});
test('custom links accept only bounded invite/recovery hashes and reject other purposes',()=>{
 const token='a'.repeat(64);assert.deepEqual(emailTokenLink('#type=invite&token_hash='+token),{type:'invite',tokenHash:token});
 assert.deepEqual(emailTokenLink('', '?type=recovery&token_hash='+token),{type:'recovery',tokenHash:token});
 for(const value of ['','tiny','a'.repeat(513),'https://evil.invalid'])assert.equal(emailTokenLink('#type=invite&token_hash='+encodeURIComponent(value)),null);
 assert.equal(emailTokenLink('#type=signup&token_hash='+token),null);
 assert.equal(emailLinkIssue('#type=signup&token_hash='+token),'invalid');
});
