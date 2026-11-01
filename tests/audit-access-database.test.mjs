import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('audited staff and enquiry boundaries hold through direct SQL and RPC calls', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create role supabase_auth_admin bypassrls;create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,created_at timestamptz default now());
    alter table storage.objects enable row level security;
    grant usage on schema auth,public,storage to anon,authenticated,service_role,supabase_auth_admin;
    grant select,delete on auth.users to supabase_auth_admin;
    alter default privileges in schema public grant all on tables to anon,authenticated;`);
  await db.exec(await readFile(new URL('../supabase/setup.sql', import.meta.url), 'utf8'));
  // Also exercise the upgrade path when setup.sql has not yet been regenerated.
  await db.exec(await readFile(new URL('../supabase/migrations/20261101151843_audit_staff_and_enquiry_security.sql', import.meta.url), 'utf8'));
  const ids = {}, people = ['owner', 'owner2', 'admin', 'manager', 'editor', 'editor2', 'customer', 'customer2', 'pending'];
  for (const [index, name] of people.entries()) {
    const id = 'e1000000-0000-4000-8000-' + String(index + 1).padStart(12, '0');
    ids[name] = id;
    await db.query('insert into auth.users(id,email,email_confirmed_at,encrypted_password)values($1,$2,$3,$4)',
      [id, name + '@icue.vn', name === 'pending' ? null : new Date().toISOString(), 'original-' + name]);
    if (!['customer', 'customer2', 'pending'].includes(name)) {
      const role = name === 'owner2' ? 'owner' : name === 'editor2' ? 'editor' : name;
      await db.query('insert into team_members(user_id,email,display_name,role)values($1,$2,$3,$4)', [id, name + '@icue.vn', name, role]);
    }
  }
  async function as(name) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids[name] || '']);
    await db.exec('set role ' + (['service_role', 'supabase_auth_admin', 'anon'].includes(name) ? name : name === 'root' ? 'postgres' : 'authenticated'));
  }
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const denied = promise => assert.rejects(promise, error => error.code === '42501');
  const property = (await one("select id from properties where status='published' limit 1")).id;

  await t.test('unconfirmed existing credentials cannot acquire staff access by direct assignment', async () => {
    await as('owner');
    assert.equal((await one("select find_staff_account('pending@icue.vn','editor') as id")).id, ids.pending);
    await assert.rejects(db.query("select assign_staff_account('pending@icue.vn','Pending staff','editor')"), error => error.code === '23514');
    await as('root');
    assert.equal((await one('select count(*)::int as n from team_members where user_id=$1', [ids.pending])).n, 0);
    assert.deepEqual(await one('select encrypted_password,email_confirmed_at from auth.users where id=$1', [ids.pending]), { encrypted_password: 'original-pending', email_confirmed_at: null });
    await db.query('update auth.users set email_confirmed_at=now() where id=$1', [ids.pending]);
    await as('owner');
    assert.equal((await one("select assign_staff_account('pending@icue.vn','Verified staff','editor') as id")).id, ids.pending);
    await as('pending');
    assert.equal((await one('select private.is_editor() as allowed')).allowed, true);
  });

  await t.test('a manager can revoke stale lower-level email grants without authorizing restoration or protected accounts', async () => {
    await as('root');
    await db.query("update auth.users set email='changed@elsewhere.invalid' where id=$1", [ids.editor]);
    await as('manager');
    assert.equal((await one("select set_staff_access($1,'editor',false) as id", [ids.editor])).id, ids.editor);
    await assert.rejects(db.query("select set_staff_access($1,'editor',true)", [ids.editor]), error => error.code === '23514');
    for (const name of ['manager', 'admin', 'owner']) {
      await denied(db.query("select set_staff_access($1,'editor',false)", [ids[name]]));
    }
    await denied(db.query("select set_staff_access($1,'admin',false)", [ids.editor2]));
    await as('root');
    assert.equal((await one('select active from team_members where user_id=$1', [ids.editor])).active, false);
    await db.query("update auth.users set email='editor@icue.vn' where id=$1", [ids.editor]);
    await as('editor');
    assert.equal((await one('select private.is_editor() as allowed')).allowed, false);
  });

  await t.test('trusted parent deletions clear references while customer updates remain cancellation-only', async () => {
    await as('root');
    const enquiry = (await one("insert into enquiries(user_id,property_id,name,email,message,kind,consent)values($1,$2,'Customer','customer@icue.vn','Please arrange my viewing','viewing',true)returning id", [ids.customer, property])).id;
    const second = (await one("insert into enquiries(user_id,name,email,message,kind,consent)values($1,'Customer Two','customer2@icue.vn','Please arrange another viewing','viewing',true)returning id", [ids.customer2])).id;
    await denied(db.query("update enquiries set status='closed' where id=$1", [enquiry]));
    await as('customer');
    await denied(db.query("update enquiries set status='scheduled',cancelled_at=now() where id=$1", [enquiry]));
    await denied(db.query('update enquiries set appointment_at=now(),cancelled_at=now() where id=$1', [enquiry]));
    await db.query('update enquiries set cancelled_at=now() where id=$1', [enquiry]);
    await as('root');
    const before = await one('select id,user_id,property_id,status,message,cancelled_at from enquiries where id=$1', [enquiry]);
    await db.query('delete from properties where id=$1', [property]);
    await db.query('delete from auth.users where id=$1', [ids.customer]);
    assert.deepEqual(await one('select id,user_id,property_id,status,message,cancelled_at from enquiries where id=$1', [enquiry]), { ...before, user_id: null, property_id: null });
    await as('supabase_auth_admin');
    await db.query('delete from auth.users where id=$1', [ids.customer2]);
    await as('root');
    assert.equal((await one('select user_id from enquiries where id=$1', [second])).user_id, null);
  });

  await t.test('direct attribution writes enforce active peer/lower choices and retain existing higher credit only', async () => {
    await as('root');
    const anotherProperty = (await one("select id from properties where status='published' limit 1")).id;
    const makeReport = async () => (await one("insert into property_assistance(property_id,name,email,helper_name,channel,helped_where,helped_on,consent)values($1,'Customer','guest@example.invalid','Named Helper','phone','Hanoi',current_date-1,true)returning id", [anotherProperty])).id;
    const newReport = await makeReport(), oldReport = await makeReport();
    await as('manager');
    await denied(db.query("insert into assistance_reviews(report_id,credited_staff_id,confirmed_helper,reviewed_by)values($1,$2,'Named Helper',auth.uid())", [newReport, ids.owner]));
    await db.query("insert into assistance_reviews(report_id,credited_staff_id,confirmed_helper,reviewed_by)values($1,$2,'Named Helper',auth.uid())", [newReport, ids.editor2]);
    await denied(db.query('update assistance_reviews set credited_staff_id=$2 where report_id=$1', [newReport, ids.owner]));
    await as('owner');
    await db.query("select review_property_assistance($1,'verified',$2,'Named Helper','Original')", [oldReport, ids.owner]);
    await as('manager');
    await db.query("select review_property_assistance($1,'verified',$2,'Named Helper','Retain existing owner')", [oldReport, ids.owner]);
    await db.query("update assistance_reviews set internal_notes='Direct retained credit',reviewed_by=auth.uid() where report_id=$1", [oldReport]);
    await denied(db.query('update assistance_reviews set credited_staff_id=$2 where report_id=$1', [oldReport, ids.owner2]));
    await denied(db.query('update assistance_reviews set credited_staff_id=$2 where report_id=$1', [oldReport, ids.editor]));
    assert.equal((await one('select credited_staff_id from assistance_reviews where report_id=$1', [oldReport])).credited_staff_id, ids.owner);
    await as('pending');
    await denied(db.query("insert into assistance_reviews(report_id,credited_staff_id,reviewed_by)values($1,$2,auth.uid())", [oldReport, ids.pending]));
  });
});
