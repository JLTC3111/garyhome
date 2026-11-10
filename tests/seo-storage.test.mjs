import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('SEO audit storage enforces staff reads, service writes, leases and twenty-run retention',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;create table auth.users(id uuid primary key);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table public.members(user_id uuid,active boolean);create function private.is_editor()returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.members where user_id=auth.uid() and active)$$;grant usage on schema public,private,auth to authenticated,anon,service_role;grant execute on function private.is_editor() to authenticated;`);
 const migration=await readFile(new URL('../supabase/migrations/20261110090607_seo_audit_system.sql',import.meta.url),'utf8');await db.exec(migration);
 const staff='80000000-0000-4000-8000-000000000001',other='80000000-0000-4000-8000-000000000002';
 await db.query('insert into auth.users values($1),($2)',[staff,other]);await db.query('insert into members values($1,true)',[staff]);
 const as=async role=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[role==='staff'?staff:role==='customer'?other:'']);await db.exec('set role '+(role==='staff'||role==='customer'?'authenticated':role));};
 const queued={status:'queued',pages:[],skippedUrls:[]};
 const create=async trigger=>(await db.query('select public.seo_create_audit($1::jsonb,$2,\'site\') as run',[queued,trigger||'manual'])).rows[0].run;
 const claim=async id=>(await db.query('select public.seo_claim_audit($1) as run',[id])).rows[0].run;
 const save=async(id,token,state)=>(await db.query('select public.seo_save_audit($1,$2,$3::jsonb,$4::jsonb) as ok',[id,token,state,{page_count:0,critical_count:0,content_score:null,technical_score:null}])).rows[0].ok;
 await t.test('guests, customers and revoked staff cannot read; staff cannot mutate or run worker RPCs',async()=>{
  await as('anon');await assert.rejects(db.query('select * from seo_audit_settings'),e=>e.code==='42501');
  await as('customer');assert.equal((await db.query('select * from seo_audit_settings')).rows.length,0);
  await as('staff');assert.equal((await db.query('select * from seo_audit_settings')).rows.length,1);await assert.rejects(db.query('update seo_audit_settings set weekly_enabled=true'),e=>e.code==='42501');await assert.rejects(create(),e=>e.code==='42501');
  await as('postgres');await db.query('update members set active=false');await as('staff');assert.equal((await db.query('select * from seo_audit_settings')).rows.length,0);await as('postgres');await db.query('update members set active=true');
 });
 await t.test('singleton active audit, lease exclusion and stale worker compare-and-swap',async()=>{
  await as('service_role');const first=await create(),second=await create();assert.equal(first.id,second.id);
  const lease=await claim(first.id);assert.ok(lease.lease_token);assert.equal(await claim(first.id),null);
  assert.equal(await save(first.id,crypto.randomUUID(),{...queued,status:'completed'}),false);
  assert.equal(await save(first.id,lease.lease_token,{...queued,status:'completed'}),true);
  assert.equal(await save(first.id,lease.lease_token,{...queued,status:'failed'}),false);
 });
 await t.test('weekly scans only start when enabled and due',async()=>{
  await as('service_role');assert.equal(await create('weekly'),null);await db.exec("update seo_audit_settings set weekly_enabled=true,next_run_at=now()-interval '1 minute'");
  const run=await create('weekly');assert.equal(run.trigger,'weekly');const lease=await claim(run.id);await save(run.id,lease.lease_token,{...queued,status:'completed'});assert.equal(await create('weekly'),null);
 });
 await t.test('expired leases recover and only the newest twenty runs remain',async()=>{
  await as('service_role');const run=await create(),old=await claim(run.id);await db.query("update seo_audit_runs set lease_until=now()-interval '1 second' where id=$1",[run.id]);const replacement=await claim(run.id);assert.notEqual(replacement.lease_token,old.lease_token);assert.equal(await save(run.id,old.lease_token,{...queued,status:'completed'}),false);await save(run.id,replacement.lease_token,{...queued,status:'completed'});
  for(let i=0;i<22;i++){const run=await create(),lease=await claim(run.id);await save(run.id,lease.lease_token,{...queued,status:i%2?'incomplete':'completed'});}
  assert.equal((await db.query('select count(*)::int n from seo_audit_runs')).rows[0].n,20);
 });
});
