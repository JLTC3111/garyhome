begin;
create temporary table moved_media(old_path text primary key,new_path text not null) on commit drop;
insert into moved_media values
('/images/activities/feedback-1.jpg','/images/activities/activity-1.jpg'),
('/images/activities/feedback-2.jpg','/images/activities/activity-2.jpg'),
('/images/activities/feedback-3.jpg','/images/activities/activity-3.jpg'),
('/images/activities/feedback-4.jpg','/images/activities/activity-4.jpg'),
('/images/activities/feedback-5.jpg','/images/activities/activity-5.jpg'),
('/images/activities/feedback-6.jpg','/images/activities/activity-6.jpg'),
('/images/area-bac-tu-liem.jpg','/images/apartments/can-studio-tai-ngoa-long-bac-tu-liem-0.jpg'),
('/images/can-studio-tai-ngoa-long-bac-tu-liem-0.jpg','/images/apartments/can-studio-tai-ngoa-long-bac-tu-liem-0.jpg'),
('/images/area-long-bien.jpg','/images/apartments/area-long-bien.jpg'),
('/images/area-tay-ho.jpg','/images/apartments/area-tay-ho.jpg'),
('/images/beautiful-apartment-with-one-bedroom-peaceful-place-0.jpg','/images/apartments/beautiful-apartment-with-one-bedroom-peaceful-place-1.jpg'),
('/images/beautiful-apartment-with-one-bedroom-peaceful-place-1.jpg','/images/apartments/beautiful-apartment-with-one-bedroom-peaceful-place-1.jpg'),
('/images/beautiful-apartment-with-one-bedroom-peaceful-place-2.jpg','/images/apartments/beautiful-apartment-with-one-bedroom-peaceful-place-2.jpg'),
('/images/beautiful-apartment-with-one-bedroom-peaceful-place-3.jpg','/images/apartments/beautiful-apartment-with-one-bedroom-peaceful-place-3.jpg'),
('/images/can-ho-1n-co-ban-cong-buoi-0.jpg','/images/apartments/can-ho-1n-co-ban-cong-buoi-0.jpg'),
('/images/can-ho-1n-co-ban-cong-buoi-1.jpg','/images/apartments/can-ho-1n-co-ban-cong-buoi-1.jpg'),
('/images/can-ho-1n-co-ban-cong-buoi-2.jpg','/images/apartments/can-ho-1n-co-ban-cong-buoi-2.jpg'),
('/images/can-ho-1n-co-ban-cong-buoi-3.jpg','/images/apartments/can-ho-1n-co-ban-cong-buoi-3.jpg'),
('/images/can-ho-1n-pho-dao-tan-0.jpg','/images/apartments/can-ho-1n-pho-dao-tan-0.jpg'),
('/images/can-ho-1n-pho-dao-tan-1.jpg','/images/apartments/can-ho-1n-pho-dao-tan-1.jpg'),
('/images/can-ho-1n-pho-dao-tan-2.jpg','/images/apartments/can-ho-1n-pho-dao-tan-2.jpg'),
('/images/can-ho-1n-pho-dao-tan-3.jpg','/images/apartments/can-ho-1n-pho-dao-tan-3.jpg'),
('/images/can-ho-1n-tai-290-kim-ma-0.jpg','/images/apartments/can-ho-1n-tai-290-kim-ma-0.jpg'),
('/images/can-ho-1n-tai-290-kim-ma-1.jpg','/images/apartments/can-ho-1n-tai-290-kim-ma-1.jpg'),
('/images/can-ho-1n-tai-290-kim-ma-2.jpg','/images/apartments/can-ho-1n-tai-290-kim-ma-2.jpg'),
('/images/can-ho-1n-tai-290-kim-ma-3.jpg','/images/apartments/can-ho-1n-tai-290-kim-ma-3.jpg'),
('/images/can-ho-2n-2wc-dao-tan-0.jpg','/images/apartments/can-ho-2n-2wc-dao-tan-3.jpg'),
('/images/can-ho-2n-2wc-dao-tan-3.jpg','/images/apartments/can-ho-2n-2wc-dao-tan-3.jpg'),
('/images/can-ho-2n-2wc-dao-tan-1.jpg','/images/apartments/can-ho-2n-2wc-dao-tan-1.jpg'),
('/images/can-ho-2n-2wc-dao-tan-2.jpg','/images/apartments/can-ho-2n-2wc-dao-tan-2.jpg'),
('/images/can-ho-2n-doi-can-0.jpg','/images/apartments/can-ho-2n-doi-can-1.jpg'),
('/images/can-ho-2n-doi-can-1.jpg','/images/apartments/can-ho-2n-doi-can-1.jpg'),
('/images/can-ho-2n-doi-can-2.jpg','/images/apartments/can-ho-2n-doi-can-2.jpg'),
('/images/can-ho-2n-doi-can-3.jpg','/images/apartments/can-ho-2n-doi-can-3.jpg'),
('/images/can-ho-2n-gan-ho-0.jpg','/images/apartments/can-ho-2n-gan-ho-1.jpg'),
('/images/can-ho-2n-gan-ho-1.jpg','/images/apartments/can-ho-2n-gan-ho-1.jpg'),
('/images/can-ho-2n-gan-ho-2.jpg','/images/apartments/can-ho-2n-gan-ho-2.jpg'),
('/images/can-ho-2n-gan-ho-3.jpg','/images/apartments/can-ho-2n-gan-ho-3.jpg'),
('/images/can-ho-2n-tai-kim-ma-0.jpg','/images/apartments/can-ho-2n-tai-kim-ma-0.jpg'),
('/images/can-ho-2n-tai-kim-ma-1.jpg','/images/apartments/can-ho-2n-tai-kim-ma-1.jpg'),
('/images/can-ho-2n-tai-kim-ma-2.jpg','/images/apartments/can-ho-2n-tai-kim-ma-2.jpg'),
('/images/can-ho-2n-tai-kim-ma-3.jpg','/images/apartments/can-ho-2n-tai-kim-ma-3.jpg'),
('/images/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-0.jpg','/images/apartments/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-0.jpg'),
('/images/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-1.jpg','/images/apartments/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-1.jpg'),
('/images/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-2.jpg','/images/apartments/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-2.jpg'),
('/images/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-3.jpg','/images/apartments/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-3.jpg'),
('/images/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho-0.jpg','/images/apartments/hero.jpg'),
('/images/hero.jpg','/images/apartments/hero.jpg'),
('/images/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho-1.jpg','/images/apartments/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho-1.jpg'),
('/images/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho-2.jpg','/images/apartments/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho-2.jpg'),
('/images/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho-3.jpg','/images/apartments/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho-3.jpg'),
('/images/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-0.jpg','/images/apartments/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-0.jpg'),
('/images/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-1.jpg','/images/apartments/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-1.jpg'),
('/images/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-2.jpg','/images/apartments/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-2.jpg'),
('/images/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-3.jpg','/images/apartments/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-3.jpg'),
('/images/can-ho-studio-tai-dao-tan-ba-dinh-0.jpg','/images/apartments/can-ho-studio-tai-dao-tan-ba-dinh-3.jpg'),
('/images/can-ho-studio-tai-dao-tan-ba-dinh-3.jpg','/images/apartments/can-ho-studio-tai-dao-tan-ba-dinh-3.jpg'),
('/images/can-ho-studio-tai-dao-tan-ba-dinh-1.jpg','/images/apartments/can-ho-studio-tai-dao-tan-ba-dinh-1.jpg'),
('/images/can-ho-studio-tai-dao-tan-ba-dinh-2.jpg','/images/apartments/can-ho-studio-tai-dao-tan-ba-dinh-2.jpg'),
('/images/can-ho-studio-tai-thuy-khe-tay-ho-2-0.jpg','/images/apartments/can-ho-studio-tai-thuy-khe-tay-ho-2-1.jpg'),
('/images/can-ho-studio-tai-thuy-khe-tay-ho-2-1.jpg','/images/apartments/can-ho-studio-tai-thuy-khe-tay-ho-2-1.jpg'),
('/images/can-ho-studio-tai-thuy-khe-tay-ho-2-2.jpg','/images/apartments/can-ho-studio-tai-thuy-khe-tay-ho-2-2.jpg'),
('/images/can-ho-studio-tai-thuy-khe-tay-ho-2-3.jpg','/images/apartments/can-ho-studio-tai-thuy-khe-tay-ho-2-3.jpg'),
('/images/can-studio-tai-ngoa-long-bac-tu-liem-1.jpg','/images/apartments/can-studio-tai-ngoa-long-bac-tu-liem-1.jpg'),
('/images/can-studio-tai-ngoa-long-bac-tu-liem-2.jpg','/images/apartments/can-studio-tai-ngoa-long-bac-tu-liem-2.jpg'),
('/images/can-studio-tai-ngoa-long-bac-tu-liem-3.jpg','/images/apartments/can-studio-tai-ngoa-long-bac-tu-liem-3.jpg'),
('/images/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho-0.jpg','/images/apartments/gary-way.jpg'),
('/images/gary-way.jpg','/images/apartments/gary-way.jpg'),
('/images/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho-1.jpg','/images/apartments/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho-1.jpg'),
('/images/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho-2.jpg','/images/apartments/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho-2.jpg'),
('/images/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho-3.jpg','/images/apartments/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho-3.jpg'),
('/images/lux-apartment-in-dang-thai-ma-tay-ho-0.jpg','/images/apartments/lux-apartment-in-dang-thai-ma-tay-ho-0.jpg'),
('/images/lux-apartment-in-dang-thai-ma-tay-ho-1.jpg','/images/apartments/lux-apartment-in-dang-thai-ma-tay-ho-1.jpg'),
('/images/lux-apartment-in-dang-thai-ma-tay-ho-2.jpg','/images/apartments/lux-apartment-in-dang-thai-ma-tay-ho-2.jpg'),
('/images/lux-apartment-in-dang-thai-ma-tay-ho-3.jpg','/images/apartments/lux-apartment-in-dang-thai-ma-tay-ho-3.jpg'),
('/images/feeback/1.jpg','/images/feedback/1.jpg');
update public.properties p set images=(select array_agg(coalesce(m.new_path,v.url) order by v.position) from unnest(p.images) with ordinality v(url,position) left join moved_media m on m.old_path=v.url) where exists(select 1 from unnest(p.images) v(url) join moved_media m on m.old_path=v.url);
update public.neighbourhoods n set image=m.new_path from moved_media m where n.image=m.old_path;
update public.site_settings s set hero_image=m.new_path from moved_media m where s.hero_image=m.old_path;
update public.site_activities a set image_url=m.new_path from moved_media m where a.image_url=m.old_path;
update public.listing_authors a set portrait_url=m.new_path from moved_media m where a.portrait_url=m.old_path;
update public.site_settings set whatsapp_phone='+84363327342',zalo_phone='0363327342' where id='main';
update public.listing_authors set whatsapp_phone='+84363327342',zalo_phone='0363327342' where slug='gary-home-team' and is_placeholder;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('81145523-90a0-5659-b203-c071c4755a3b','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758363774_250296199991685643_250296199991685643_8d57aff1a985be89d04e709012310333.jpg','',true,-20) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('9a0d7b0d-738a-5114-8cc7-f0b38b2eb247','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758372920_250296199991685643_250296199991685643_8f7a49949dc1bc9736e22ee5ad5712a5.jpg','',true,-19) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('892ea64a-8a73-538a-a1bf-31d36b20a4ca','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758403181_250296199991685643_250296199991685643_5f2331433c19d7fc214897ba9d222ae7.jpg','',true,-18) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('1833b425-cd8c-52c7-bffe-3ca3911c73d2','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758403190_250296199991685643_250296199991685643_5261cdcc406e3ff6352a67fe20c39fbe.jpg','',true,-17) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('4f25795d-a2c1-5d39-9a83-cdbd1ed87b34','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758403196_250296199991685643_250296199991685643_8dcd84faaab5a65e6f1a7ca531826322.jpg','',true,-16) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('13975278-7c4f-55c1-b61d-c8fb4ae10e16','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758403206_250296199991685643_250296199991685643_0cc9015f7965edf29d422df98b2d6880.jpg','',true,-15) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('04895f81-82cc-563a-a99b-c3eeccdae28a','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758403213_250296199991685643_250296199991685643_ba2b14bd2a82bd8c638ca2f70aaa2a7e.jpg','',true,-14) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('988f3dcf-d9aa-5e96-b443-5cd6626b2700','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758410595_250296199991685643_250296199991685643_b1a1bb38db4acd04e4c8f7bfb8de67a7.jpg','',true,-13) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('8c237014-6403-5356-9488-78ca4eccc803','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758410599_250296199991685643_250296199991685643_e73fcef432b38ff9e97dfc6428c2ec22.jpg','',true,-12) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('457c442d-31e9-531c-a459-d0efe19b6615','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758410603_250296199991685643_250296199991685643_f2a18d093dbd9d44cc5834f51d32e306.jpg','',true,-11) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('152b4164-efaf-5e3f-a40b-35ccfa761eac','feedback','screenshot','Customer feedback shared with Gary Home','Phản hồi khách hàng gửi đến Gary Home','/images/feedback/1.jpg','',true,-10) on conflict(id) do nothing;
notify pgrst,'reload schema';
commit;
