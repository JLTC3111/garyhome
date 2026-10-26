import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('customer portal permissions in real Postgres', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const staff = '00000000-0000-4000-8000-000000000001';
  const alice = '00000000-0000-4000-8000-000000000002';
  const bob = '00000000-0000-4000-8000-000000000003';
  const property = '00000000-0000-4000-8000-000000000010';
  const fields = 'id,user_id,name,email,message,status,appointment_at,customer_update,cancelled_at';
  async function as(role, uid = '') {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
    await db.exec(`set role ${role}`);
  }
  await db.exec(`create role anon; create role authenticated;create role service_role bypassrls; create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,created_at timestamptz default now());
    alter table storage.objects enable row level security;
    grant usage on schema auth,public,storage to anon,authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated;`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261021152453_gary_home_cms.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into auth.users values ('${staff}','staff@example.invalid'),('${alice}','alice@example.invalid'),('${bob}','bob@example.invalid');
    insert into public.team_members(user_id,role) values ('${staff}','editor');
    insert into public.neighbourhoods(slug,name,image) values ('tay-ho','Tây Hồ','/area.jpg');
    insert into public.properties(id,slug,title_en,title_vi,district_slug,address,images,status) values ('${property}','test-home','Home','Nhà','tay-ho','Hanoi',array['/home.jpg'],'published');
    insert into public.enquiries(name,email,message,consent,notes) values ('Legacy guest','alice@example.invalid','A historical guest message.',true,'A private legacy note');`);
  const diagnostic = await readFile(new URL('../supabase/diagnostics/customer-portal.sql', import.meta.url), 'utf8');
  const before = (await db.query(diagnostic)).rows;
  assert.equal(before.length, 1);
  assert.deepEqual(before[0].missing_tables, ['customer_profiles','customer_records','enquiry_notes','saved_homes']);
  assert.equal(before[0].missing_columns.length, 16);
  assert.equal(before[0].staff_access_helper_exists, true);
  assert.equal(before[0].staff_enquiry_update_exists, false);
  await db.exec(await readFile(new URL('../supabase/migrations/20261021201948_customer_portal.sql', import.meta.url), 'utf8'));
  await t.test('the customer migration resolves every diagnostic item', async () => {
    const { rows } = await db.query(diagnostic);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { missing_tables: [], missing_columns: [], staff_access_helper_exists: true, staff_enquiry_update_exists: true });
  });
  let aliceEnquiry;

  await t.test('customers can edit only their own profile and cannot promote themselves', async () => {
    await as('authenticated', alice);
    await db.exec("insert into public.customer_profiles(full_name,email) values ('Alice','alice@example.invalid')");
    await assert.rejects(db.query('insert into public.customer_profiles(user_id,email) values ($1,$2)', [bob, 'bob@example.invalid']));
    await assert.rejects(db.exec(`update public.customer_profiles set user_id='${bob}'`));
    await assert.rejects(db.exec(`insert into public.team_members values ('${alice}','owner',now())`));
    await as('authenticated', bob);
    assert.equal((await db.query('select * from public.customer_profiles')).rows.length, 0);
    assert.equal((await db.query("update public.customer_profiles set full_name='Changed' returning user_id")).rows.length, 0);
  });
  await t.test('saved homes are isolated across customers and staff', async () => {
    await as('authenticated', alice);
    await db.query('insert into public.saved_homes(property_id) values ($1)', [property]);
    await assert.rejects(db.query('insert into public.saved_homes(user_id,property_id) values ($1,$2)', [bob, property]));
    await as('authenticated', bob);
    assert.equal((await db.query('select * from public.saved_homes')).rows.length, 0);
    assert.equal((await db.query('delete from public.saved_homes returning property_id')).rows.length, 0);
    await as('authenticated', staff);
    assert.equal((await db.query('select * from public.saved_homes')).rows.length, 0);
  });
  await t.test('authenticated enquiries acquire server-owned identity; matching guest email grants no history', async () => {
    await as('authenticated', alice);
    await db.query("insert into public.enquiries(name,email,message,kind,consent,property_id) values ('Alice','alice@example.invalid','Please arrange my viewing.','viewing',true,$1)", [property]);
    const rows = (await db.query(`select ${fields} from public.enquiries`)).rows;
    assert.equal(rows.length, 1);assert.equal(rows[0].user_id, alice);aliceEnquiry = rows[0].id;
    await assert.rejects(db.query("insert into public.enquiries(user_id,name,email,message,consent) values ($1,'Alice','alice@example.invalid','A forged viewing request.',true)", [bob]));
    await as('authenticated', bob);
    assert.equal((await db.query(`select ${fields} from public.enquiries`)).rows.length, 0);
  });
  await t.test('legacy and new internal notes remain inaccessible to every customer', async () => {
    await as('authenticated', alice);
    await assert.rejects(db.exec('select notes from public.enquiries'));
    await assert.rejects(db.exec('select * from public.enquiries'));
    assert.equal((await db.query('select * from public.enquiry_notes')).rows.length, 0);
    await assert.rejects(db.query('insert into public.enquiry_notes(enquiry_id,notes) values ($1,$2)', [aliceEnquiry, 'Forged staff note']));
    await as('authenticated', staff);
    assert.equal((await db.query('select notes from public.enquiry_notes')).rows[0].notes, 'A private legacy note');
    await db.query('insert into public.enquiry_notes(enquiry_id,notes) values ($1,$2)', [aliceEnquiry, 'Staff only']);
  });
  await t.test('only staff can confirm an appointment and publish a customer update', async () => {
    await as('authenticated', alice);
    await assert.rejects(db.query("update public.enquiries set status='scheduled',appointment_at=now() where id=$1", [aliceEnquiry]));
    await assert.rejects(db.query("update public.enquiries set customer_update='Forged reply',cancelled_at=now() where id=$1", [aliceEnquiry]));
    await as('authenticated', staff);
    await db.query("update public.enquiries set status='scheduled',appointment_at=now()+interval '1 day',customer_update='See you tomorrow.' where id=$1", [aliceEnquiry]);
    await as('authenticated', alice);
    assert.equal((await db.query(`select ${fields} from public.enquiries`)).rows[0].customer_update, 'See you tomorrow.');
  });
  await t.test('customers can cancel their own viewing once, without rewriting staff workflow', async () => {
    await as('authenticated', bob);
    assert.equal((await db.query('update public.enquiries set cancelled_at=now() where id=$1 returning id', [aliceEnquiry])).rows.length, 0);
    await as('authenticated', alice);
    const cancelled = (await db.query('update public.enquiries set cancelled_at=now() where id=$1 returning id,status,cancelled_at', [aliceEnquiry])).rows;
    assert.equal(cancelled.length, 1);assert.equal(cancelled[0].status, 'scheduled');assert.ok(cancelled[0].cancelled_at);
    assert.equal((await db.query('update public.enquiries set cancelled_at=null where id=$1 returning id', [aliceEnquiry])).rows.length, 0);
  });
  await t.test('CRM notes, stages and follow-ups are visible and writable only by staff', async () => {
    await as('authenticated', staff);
    await db.query("insert into public.customer_records(customer_key,user_id,name,email,stage,notes,follow_up_on) values ($1,$2,'Alice','alice@example.invalid','viewing','Private follow-up',current_date)", ['user:' + alice, alice]);
    await as('authenticated', alice);
    assert.equal((await db.query('select * from public.customer_records')).rows.length, 0);
    assert.equal((await db.query("update public.customer_records set stage='tenant' returning customer_key")).rows.length, 0);
    await assert.rejects(db.exec("insert into public.customer_records(customer_key,name,email) values ('manual:forged','Forged','fake@example.invalid')"));
    await as('authenticated', staff);
    assert.equal((await db.query('select * from public.customer_records')).rows[0].notes, 'Private follow-up');
    assert.equal((await db.query('select * from public.customer_profiles')).rows.length, 1);
  });
  await t.test('the staff save RPC is atomic and preserves RLS', async () => {
    await as('authenticated', alice);
    await assert.rejects(db.query("select public.save_customer_enquiry($1,'closed','Forged',null,'Fake update')", [aliceEnquiry]));
    await as('authenticated', staff);
    await db.query("select public.save_customer_enquiry($1,'closed','Updated staff note',null,'Your request is closed.')", [aliceEnquiry]);
    assert.equal((await db.query('select notes from public.enquiry_notes where enquiry_id=$1', [aliceEnquiry])).rows[0].notes, 'Updated staff note');
    await assert.rejects(db.query("select public.save_customer_enquiry($1,'contacted',$2,null,'Must roll back')", [aliceEnquiry, 'x'.repeat(8001)]));
    assert.equal((await db.query('select status,customer_update from public.enquiries where id=$1', [aliceEnquiry])).rows[0].customer_update, 'Your request is closed.');
    await as('anon');
    await assert.rejects(db.query("select public.save_customer_enquiry($1,'closed','',null,'')", [aliceEnquiry]));
  });
  await t.test('anonymous users cannot read customer data, and new tables all enable RLS', async () => {
    await as('anon');
    for (const table of ['customer_profiles','saved_homes','customer_records','enquiry_notes']) await assert.rejects(db.exec(`select * from public.${table}`));
    await db.exec("insert into public.enquiries(name,email,message,consent) values ('New guest','guest@example.invalid','A public request still works.',true)");
    await as('postgres');
    const tables = (await db.query("select relname,relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r'")).rows;
    assert.equal(tables.length, 9);assert.ok(tables.every(row => row.relrowsecurity));
  });
});
