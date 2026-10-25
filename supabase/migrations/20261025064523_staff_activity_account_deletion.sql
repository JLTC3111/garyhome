begin;

-- Keep audit snapshots when an Auth account is removed through Supabase.
-- Cascading membership deletion runs after the Auth row has disappeared.
create or replace function private.append_studio_event(event_category text,event_action text,target uuid,target_label text,target_level text,event_details jsonb default '{}') returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into public.studio_notifications(category,action,actor_user_id,actor_name,target_user_id,target_name,target_role,details)
 values(event_category,event_action,
  (select u.id from auth.users u where u.id=auth.uid()),
  coalesce((select display_name from public.team_members where user_id=auth.uid()),''),
  (select u.id from auth.users u where u.id=target),
  coalesce(target_label,''),target_level,event_details);
end; $$;
revoke all on function private.append_studio_event(text,text,uuid,text,text,jsonb) from public,anon,authenticated;

commit;
