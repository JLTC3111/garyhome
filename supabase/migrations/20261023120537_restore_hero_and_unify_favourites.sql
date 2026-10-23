begin;

-- Preserve existing customer selections in their own favourites before retiring the cart.
lock table public.rental_cart in share row exclusive mode;
insert into public.saved_homes(user_id,property_id,created_at)
select c.user_id,c.property_id,c.created_at from public.rental_cart c
join public.properties p on p.id=c.property_id and p.status='published'
  and p.listing_type='rent' and p.availability in ('available','on_request')
on conflict(user_id,property_id) do nothing;
-- Historical records remain stored privately; the app no longer exposes a second shortlist.
revoke all on public.rental_cart from anon,authenticated;

-- Restore the previous introduction in both languages. Preserve the selected photo.
update public.site_settings set
  hero_title_en='Find a place.
Feel at home.',
  hero_title_vi='Tìm một nơi.
Gọi là nhà.',
  hero_text_en='Thoughtfully chosen homes. A team that knows Hanoi. Let’s find the place that feels like you.',
  hero_text_vi='Những ngôi nhà được chọn lọc. Đội ngũ am hiểu Hà Nội. Cùng tìm nơi thuộc về bạn.'
where id='main';
-- The user requested that photographs live under Customers; screenshots stay in Feedback.
update public.site_activities set category='customers',
 caption_en=case when caption_en='From Gary Home’s Feedback collection' then 'Moments with Gary Home' else caption_en end,
 caption_vi=case when caption_vi='Từ bộ ảnh Phản hồi của Gary Home' then 'Khoảnh khắc cùng Gary Home' else caption_vi end,
 updated_at=now()
where category='feedback' and media_kind='photo' and published;
notify pgrst,'reload schema';
commit;
