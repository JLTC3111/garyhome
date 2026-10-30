import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('dual-currency prices, editable codes and concurrent-edit versions enforce database rules',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,created_at timestamptz default now());
    alter table storage.objects enable row level security;grant usage on schema auth,public,storage to anon,authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated;`);
  await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
  const owner='00000000-0000-4000-8000-000000000001',customer='00000000-0000-4000-8000-000000000002';
  await db.exec(`insert into auth.users(id,email,email_confirmed_at)values('${owner}','owner@protonmail.com',now()),('${customer}','customer@example.invalid',now());insert into public.team_members(user_id,role,email,display_name,bootstrap_owner)values('${owner}','owner','owner@protonmail.com','QA owner',true);`);
  async function as(role='postgres',id=''){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+role);}
  const insert=(slug,code=null)=>db.query("insert into public.properties(slug,title_en,title_vi,district_slug,address,listing_code)values($1,'Test home','Nhà thử','tay-ho','Tây Hồ',$2)returning id,listing_code",[slug,code]);
  await as('authenticated',owner);const row=(await insert('dual-price-test','gh 90')).rows[0];

  await t.test('VND-only, USD-only and dual quotes save independently; invalid VND bounds fail',async()=>{
    await db.query('update public.properties set price=null,price_vnd=15000000,price_vnd_max=20000000 where id=$1',[row.id]);
    let value=(await db.query('select price,price_vnd,price_vnd_max from public.properties where id=$1',[row.id])).rows[0];assert.deepEqual(value,{price:null,price_vnd:'15000000',price_vnd_max:'20000000'});
    await db.query('update public.properties set price=600,price_max=800 where id=$1',[row.id]);
    assert.equal((await db.query('select price_vnd from public.properties where id=$1',[row.id])).rows[0].price_vnd,'15000000');
    for(const [min,max] of [[null,20000000],[20000000,15000000],[-1,null],['NaN',null],[1,'NaN']])await assert.rejects(db.query('update public.properties set price_vnd=$1,price_vnd_max=$2 where id=$3',[min,max,row.id]),error=>error.code==='23514');
    await db.query('update public.properties set price_vnd=null,price_vnd_max=null where id=$1',[row.id]);
    value=(await db.query('select price,price_max from public.properties where id=$1',[row.id])).rows[0];assert.deepEqual(value,{price:'600.00',price_max:'800.00'});
  });
  await t.test('custom IDs normalize, rename existing listings and reserve codes across all statuses',async()=>{
    assert.equal(row.listing_code,'GH-000090');
    await assert.rejects(insert('duplicate-draft','90'),error=>error.code==='23505');
    const renamed=(await db.query("update public.properties set listing_code='gh-91' where id=$1 returning id,listing_code",[row.id])).rows[0];assert.deepEqual(renamed,{id:row.id,listing_code:'GH-000091'});
    const other=(await insert('reused-id-after-rename','GH-000090')).rows[0];assert.notEqual(other.id,row.id);
    await assert.rejects(db.query('update public.properties set listing_code=$1 where id=$2',[other.listing_code,row.id]),error=>error.code==='23505');
    for(const code of ['GH-abc','1234567890123',''])await assert.rejects(db.query('update public.properties set listing_code=$1 where id=$2',[code,row.id]),error=>error.code==='23514');
  });
  await t.test('automatic assignment skips custom reservations and never truncates seven-digit IDs',async()=>{
    await as();const next=Number((await db.query('select last_value from public.property_listing_code_seq')).rows[0].last_value)+1;
    await as('authenticated',owner);await insert('reserved-auto-code',String(next));
    assert.equal((await insert('automatic-after-reservation')).rows[0].listing_code,'GH-'+String(next+1).padStart(6,'0'));
    await as();await db.exec("select setval('public.property_listing_code_seq',999999,true)");await as('authenticated',owner);
    assert.equal((await insert('automatic-seven-digits')).rows[0].listing_code,'GH-1000000');
  });
  await t.test('a stale conditional update cannot overwrite the first editor and the server owns its version',async()=>{
    const before=(await db.query('select updated_at::text as version from public.properties where id=$1',[row.id])).rows[0].version;
    const first=(await db.query("update public.properties set title_en='First editor',updated_at='2000-01-01' where id=$1 and updated_at=$2 returning updated_at::text as version",[row.id,before])).rows;
    assert.equal(first.length,1);assert.notEqual(first[0].version,before);assert.ok(Date.parse(first[0].version)>Date.parse('2000-01-01'));
    assert.equal((await db.query("update public.properties set title_en='Stale editor' where id=$1 and updated_at=$2 returning id",[row.id,before])).rows.length,0);
    assert.equal((await db.query('select title_en from public.properties where id=$1',[row.id])).rows[0].title_en,'First editor');
  });
  await t.test('new fields and editable IDs retain existing staff-only write permissions',async()=>{
    await db.query("update public.properties set status='published',images=array['/images/apartments/hero.jpg'],price=null,price_max=null,price_vnd=15000000 where id=$1",[row.id]);
    await as('anon');assert.equal((await db.query('select price_vnd,listing_code from public.properties where id=$1',[row.id])).rows[0].price_vnd,'15000000');
    await assert.rejects(db.query("update public.properties set listing_code='GH-000099' where id=$1",[row.id]));
    await as('authenticated',customer);assert.equal((await db.query("update public.properties set price_vnd=1,listing_code='GH-000099' where id=$1 returning id",[row.id])).rows.length,0);
  });
});
