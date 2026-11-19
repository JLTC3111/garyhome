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
      if (table !== 'properties') return Response.json([]);
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
