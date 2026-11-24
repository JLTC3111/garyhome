import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createClient} from '@supabase/supabase-js';
import {galleryPhotoMetadata, pruneImageMetadata} from '../lib/image-metadata.ts';
import {readPublishedContent} from '../lib/public-content.ts';

test('Studio photo metadata survives a database save and public gallery reload', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const legacy = '/images/can-studio-tai-ngoa-long-bac-tu-liem-0.jpg';
  const canonical = '/images/apartments/can-studio-tai-ngoa-long-bac-tu-liem-0.jpg';
  const stored = 'https://storage.example.test/storage/v1/object/public/property-media/';
  const images = [legacy, ...[1, 2, 3].map(n => `${stored}123e4567-e89b-12d3-a456-42661417400${n}.jpg`)];

  await db.exec(`
    create role anon;
    create table public.properties (
      id text primary key, status text, images text[], sort_order integer default 0
    );
    grant select on public.properties to anon;
  `);
  await db.query("insert into public.properties(id,status,images) values('gallery-fixture','published',$1)", [images]);
  await assert.rejects(db.query('select image_metadata from public.properties'), error => error.code === '42703');
  await db.exec(await readFile(new URL('../supabase/migrations/20261119040445_property_photo_metadata.sql', import.meta.url), 'utf8'));

  const client = createClient('https://gallery-fixture.invalid', 'sb_publishable_gallery_fixture', {
    auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
    global: {fetch: async (input, init) => {
      const url = new URL(input), table = url.pathname.split('/').at(-1);
      if (table === 'site_settings') return Response.json({id: 'main', hero_image: ''});
      if (!['properties','home_public_properties'].includes(table)) return Response.json([]);
      if (init.method === 'PATCH') {
        assert.equal(url.searchParams.get('id'), 'eq.gallery-fixture');
        const {image_metadata} = JSON.parse(init.body);
        const {rows} = await db.query("update public.properties set image_metadata=$1 where id='gallery-fixture' returning *", [image_metadata]);
        return Response.json(rows[0]);
      }
      assert.equal(url.searchParams.get('status'), 'eq.published');
      const offset = Number(url.searchParams.get('offset') || 0);
      const {rows} = await db.query("select * from public.properties where status='published' order by sort_order,id offset $1", [offset]);
      const select = url.searchParams.get('select');
      return Response.json(!select || select === '*' ? rows : rows.map(row =>
        Object.fromEntries(select.split(',').filter(column => Object.hasOwn(row, column)).map(column => [column, row[column]]))));
    }},
  });

  const draft = pruneImageMetadata(images, {
    [images[0]]: {description_en: ' Window seat in morning sun ', description_vi: 'Ghế bên cửa sổ trong nắng sớm', alt_en: 'Window seat'},
    [images[1]]: {alt_en: 'View of the courtyard'},
    [images[2]]: {public_filename: 'Terrace view.JPG'},
  });
  const saved = await client.from('properties').update({image_metadata: draft}).eq('id', 'gallery-fixture').select('*').single();
  assert.equal(saved.error, null);
  assert.deepEqual(saved.data.image_metadata, draft);

  await db.exec('set role anon');
  const {properties: [listing]} = await readPublishedContent(client);
  assert.deepEqual(listing.images, [canonical, ...images.slice(1)]);
  assert.equal(listing.image_metadata[canonical].description_en, 'Window seat in morning sun');
  const captions = listing.images.map((src, index) =>
    galleryPhotoMetadata(src, listing.image_metadata, 'en', `Photo ${index + 1} of ${listing.images.length}`));
  assert.deepEqual(captions, [
    {caption: 'Window seat in morning sun', alt: 'Window seat', filename: ''},
    {caption: 'View of the courtyard', alt: 'View of the courtyard', filename: ''},
    {caption: 'Terrace view', alt: '', filename: 'Terrace view.JPG'},
    {caption: 'Photo 4 of 4', alt: '', filename: ''},
  ]);
  assert.equal(galleryPhotoMetadata(canonical, listing.image_metadata, 'vi', 'Ảnh 1 trên 4').caption, 'Ghế bên cửa sổ trong nắng sớm');
});

test('public listing reads exclude private original filenames, drafts and Storage catalogue entries', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema private;
    create schema storage;
    create schema auth;
    grant usage on schema private, storage, auth to authenticated, anon;
    create function auth.uid() returns text language sql stable as $$ select current_setting('fixture.user_id',true) $$;
    create function private.is_editor() returns boolean language sql stable
      as $$ select current_setting('fixture.is_editor',true) is not distinct from 'yes' $$;
    create table public.properties (
      id text primary key,slug text,title_en text,title_vi text,listing_code text,author_id uuid,price_period text,rental_term text,
      overview_en text,overview_vi text,location_en text,location_vi text,furnishings_en text,furnishings_vi text,seo_features text[],
      description_en text,description_vi text,district_slug text,address text,map_address text,price numeric,price_max numeric,currency text,
      price_vnd numeric,price_vnd_max numeric,listing_type text,property_type text,bedrooms integer,bathrooms integer,area_sqm numeric,
      amenities text[],images text[],image_metadata jsonb,video_url text,featured boolean,status text,availability text,published_at timestamptz,
      source_url text,sort_order integer,created_at timestamptz,updated_at timestamptz,image_filenames jsonb
    );
    alter table public.properties enable row level security;
    grant select on public.properties to anon,authenticated;
    create policy properties_public_read on public.properties for select to anon,authenticated using(status='published');
    create policy properties_editor_read on public.properties for select to authenticated using(private.is_editor());
    insert into public.properties(id,status,listing_type,availability,image_filenames,image_metadata)
      values ('public','published','rent','available','{"a":"name-only-for-staff.jpg"}','{"a":{"public_filename":"Approved name.jpg"}}'),
             ('draft','draft','rent','available','{}','{}'),
             ('archived','archived','rent','available','{}','{}'),
             ('rented','published','rent','rented','{}','{}');
    create table public.saved_homes(user_id text,property_id text references public.properties(id));
    alter table public.saved_homes enable row level security;
    grant insert on public.saved_homes to authenticated;
    create policy saved_insert_self on public.saved_homes for insert to authenticated
      with check(user_id=(select auth.uid()));
    create policy saved_rental_only on public.saved_homes as restrictive for insert to authenticated
      with check(exists(select 1 from public.properties p where p.id=property_id and p.status='published'));
    create table storage.objects(bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant select on storage.objects to anon,authenticated;
    create policy legacy_public_catalogue on storage.objects for select to anon,authenticated using(true);
    insert into storage.objects values ('property-media','old.jpg'),('listing-videos','old.mp4'),('other','public.svg');
  `);
  for (const name of ['20261124064334_home_public_listing_projection.sql','20261124064349_home_restrict_internal_listing_reads.sql']) {
    await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
  }
  await db.exec('set role anon');
  const published = (await db.query('select * from public.home_public_properties')).rows;
  assert.deepEqual(published.map(row => row.id), ['public']);
  assert.equal(Object.hasOwn(published[0],'image_filenames'), false);
  assert.equal(published[0].image_metadata.a.public_filename,'Approved name.jpg');
  await assert.rejects(db.query('select * from public.properties'), error => error.code === '42501');
  assert.deepEqual((await db.query('select name from storage.objects')).rows,[{name:'public.svg'}]);
  await db.exec('set role authenticated');
  assert.deepEqual((await db.query('select id from public.properties')).rows,[]);
  await db.exec("set fixture.user_id='self'");
  await db.query("insert into public.saved_homes values('self','public')");
  for (const [user,property] of [['self','draft'],['self','rented'],['someone-else','public']]) {
    await assert.rejects(db.query('insert into public.saved_homes values($1,$2)',[user,property]), error => error.code === '42501');
  }
  await db.exec("set fixture.is_editor='yes'");
  assert.equal((await db.query("select image_filenames from public.properties where id='public'")).rows[0].image_filenames.a,'name-only-for-staff.jpg');
  assert.equal((await db.query('select name from storage.objects')).rows.length,3);
});
