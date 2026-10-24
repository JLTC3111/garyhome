begin;
-- Supplied collage for Our Team; preserve any subsequent CMS changes.
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)
values('a3a31423-c458-5988-b9f8-8720996f64ed','team','photo','From our team collection','Hình ảnh từ bộ sưu tập của đội ngũ','/images/ourteam/gary-home-team.png','',true,0)
on conflict(id) do nothing;
notify pgrst, 'reload schema';
commit;
