begin;
-- The original source itself states Lào Cai while this import was assigned to
-- Tây Hồ. Keep the record for staff review rather than invent a Hanoi address.
-- Match source identity and conflicting facts, never a generated database ID.
update public.properties set status='draft',updated_at=now()
where slug='beautiful-apartment-with-one-bedroom-peaceful-place'
  and address='Tỉnh Lào Cai, Việt Nam' and district_slug='tay-ho'
  and status='published';
notify pgrst,'reload schema';
commit;
