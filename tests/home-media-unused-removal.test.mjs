import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('unused-media claim and target preserve live protections and both scheduled policies',async t=>{
  const db=new PGlite();
  t.after(()=>db.close());
  // This is a disposable worker fixture. Load only the functions under test.
  await db.exec(`
    create schema auth; create schema private; create schema storage;
    create table public.properties(images text[]);
    create table storage.objects(bucket_id text,name text,id uuid,version text,metadata jsonb,primary key(bucket_id,name));
    create table private.home_media_control(singleton boolean primary key, permanent_enabled boolean,
      listing_inactivity_enabled boolean, lease uuid, lease_until timestamptz);
    insert into private.home_media_control values(true,true,false,null,null);
    create table private.home_media_runs(id uuid primary key, actor uuid, early_item uuid, early_expiry timestamptz,
      early_unused boolean default false, finished_at timestamptz, attempted integer default 0, removed integer default 0, failed integer default 0);
    create table private.home_media_items(id uuid primary key,bucket text,name text,source text,state text,bytes bigint,
      expires_at timestamptz, object_id uuid, object_version text, upload_until timestamptz, retry_after timestamptz,
      attempts integer not null default 0, deletion_started_at timestamptz, deletion_run uuid, hold_reason text,
      replacement_key text,replacement_sha256 text,replacement_id uuid,replacement_version text,historical_review jsonb);
    create table private.home_media_review_holds(bucket text,name text);
    create table private.fixture_protections(bucket text,name text, reason text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function private.require_home_photo_owner() returns void language plpgsql stable as $$
      begin if auth.uid() is distinct from '00000000-0000-4000-8000-000000000001'::uuid then
        raise exception 'forbidden' using errcode='42501'; end if; end $$;
    create function private.lock_home_listing_media_snapshot() returns void language sql as $$ select $$;
    create function private.home_media_lock_listing_inactivity() returns void language sql as $$ select $$;
    create function private.home_media_observe_listing_inactivity() returns void language plpgsql as $$
      begin raise exception 'observation cannot run in a cleanup claim' using errcode='57014'; end $$;
    create function private.home_media_stage_candidates() returns void language sql as $$ select $$;
    create function private.home_photo_key(text,text) returns text language sql as $$ select $1 $$;
    create function private.home_media_referenced(text,text,boolean) returns boolean language sql stable as $$ select false $$;
    create function private.home_media_edit_referenced(text,text) returns boolean language sql stable as $$
      select exists(select 1 from private.fixture_protections where bucket=$1 and name=$2 and reason='editing_session') $$;
    create function private.home_media_provider_upload(text,text) returns boolean language sql stable as $$
      select exists(select 1 from private.fixture_protections where bucket=$1 and name=$2 and reason='active_upload') $$;
    create function private.home_media_identity(text,text) returns setof storage.objects language sql stable as $$
      select * from storage.objects where bucket_id=$1 and name=$2 $$;
    create function private.home_media_inactivity_inventory(p_bucket text default null,p_name text default null)
    returns table(bucket text,name text,listing_code text,reason text) language sql stable as $$
      select i.bucket,i.name,'GH-FIXTURE',case
        when h.name is not null then 'recovery_hold'
        when p.reason is not null then p.reason
        when i.upload_until>now() then 'active_upload'
        when i.source<>'unused_listing' then 'legacy_lifecycle'
        when i.object_id<>o.id or i.object_version is distinct from o.version then 'awaiting_observation'
        when i.expires_at<=now() then 'eligible' else 'waiting' end
      from private.home_media_items i join storage.objects o on o.bucket_id=i.bucket and o.name=i.name
      left join private.fixture_protections p on p.bucket=i.bucket and p.name=i.name
      left join private.home_media_review_holds h on h.bucket=i.bucket and h.name=i.name
      where (p_bucket is null or i.bucket=p_bucket) and (p_name is null or i.name=p_name) $$;
  `);
  const sql=await readFile(new URL('../supabase/migrations/20261127153844_home_listing_media_manual_removal.sql',import.meta.url),'utf8');
  let definitions=0;
  for(const definition of sql.matchAll(/^create (?:or replace )?function [\s\S]*?\n\$\$;/gm)){
    await db.exec(definition[0]);
    definitions++;
  }
  assert.equal(definitions,7);
  const correction=await readFile(new URL('../supabase/migrations/20261127203648_home_media_verify_unused.sql',import.meta.url),'utf8');
  const claimDefinition=correction.match(/^create or replace function public\.home_media_claim\([\s\S]*?\n\$\$;/m);
  assert.ok(claimDefinition);
  await db.exec(claimDefinition[0]);

  const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  const one=async(query,args=[]) => (await db.query(query,args)).rows[0]?.value;
  const add=async(name,{bucket='property-media',source='unused_listing',state='retained',overdue=false}={})=>{
    const id=crypto.randomUUID(),objectId=crypto.randomUUID(),version=crypto.randomUUID();
    const expires=new Date(Date.now()+(overdue?-3600000:3600000)).toISOString();
    await db.query("insert into storage.objects values($1,$2,$3,$4,'{\"etag\":\"fixture\"}')",[bucket,name,objectId,version]);
    await db.query(`insert into private.home_media_items(id,bucket,name,source,state,bytes,expires_at,object_id,object_version,historical_review)
      values($1,$2,$3,$4,$5,120,$6,$7,$8,'{"etag":"fixture"}')`,[id,bucket,name,source,state,expires,objectId,version]);
    return { name,bucket,id,expires,version };
  };
  const legacy=await add('legacy-trash.png',{source:'historical',state:'trashed',overdue:true});
  const video=await add('early.mp4',{bucket:'listing-videos'});
  const held=await add('pending-recovery.jpg');
  await db.query('insert into private.home_media_review_holds values($1,$2)',[held.bucket,held.name]);
  const checked=await one('select public.home_media_retention_preview() value');
  assert.equal(checked.automatic,false);
  assert.equal(checked.manualCount,1);
  assert.equal(checked.items.find(row=>row.name===held.name).manual_target,null);
  assert.deepEqual((await one("select public.home_media_retention_manifest('GH-FIXTURE') value")).items.map(row=>row.id),[video.id]);

  const claim=(row,actor=owner)=>one('select public.home_media_claim_unused($1,$2,$3) value',[actor,row.id,row.expires]);
  const target=(job,row)=>one('select public.home_media_target($1,$2,true) value',[job.id,row.id]);
  const receipt=row=>one('select public.home_media_unused_receipt($1,$2) value',[row.id,row.expires]);
  const finish=()=>db.exec('update private.home_media_control set lease=null,lease_until=null');
  await assert.rejects(claim(video,other),error=>error.code==='42501');
  await assert.rejects(claim(legacy),error=>error.code==='PT409');
  assert.equal((await receipt(held)).status,'recovery_hold');
  const heldJob=await claim(held);
  assert.equal(await target(heldJob,held),null);
  await finish();

  for(const reason of ['reference','filename_match','editing_session','active_upload','lease','changed_identity']){
    const photo=await add(reason+'.jpg');
    const job=await claim(photo);
    if(reason==='lease')await db.query("update private.home_media_items set upload_until=now()+interval '1 day' where id=$1",[photo.id]);
    else if(reason==='changed_identity')await db.query('update storage.objects set version=$1 where name=$2',[crypto.randomUUID(),photo.name]);
    else await db.query('insert into private.fixture_protections values($1,$2,$3)',[photo.bucket,photo.name,reason]);
    assert.equal(await target(job,photo),null,reason);
    await finish();
  }

  const manual=await claim(video);
  assert.equal(await target(manual,legacy),null);
  assert.deepEqual(await target(manual,video),{bucket:'listing-videos',name:video.name,present:true,replacementKey:null,replacementSha256:null});
  await db.query("update private.home_media_items set hold_reason='storage' where id=$1",[video.id]);
  await finish();
  assert.equal((await receipt(video)).status,'storage_failure');
  const scheduled=await one('select public.home_media_claim() value');
  assert.deepEqual(scheduled.items.map(row=>row.id),[legacy.id]);
  assert.equal((await target(scheduled,legacy)).name,legacy.name);
  await finish();
  await db.exec('update private.home_media_control set listing_inactivity_enabled=true');
  await db.query("update private.home_media_items set retry_after=now()-interval '1 second' where id=$1",[video.id]);
  assert.ok(!(await one('select public.home_media_claim() value')).items.some(row=>row.id===video.id));
  const {rows:[legacyReceipt]}=await db.query('select expires_at from private.home_media_items where id=$1',[legacy.id]);
  assert.equal(legacyReceipt.expires_at.toISOString(),legacy.expires);
});
