begin;

-- Public forms enter through the application's validation boundary. Neither a
-- guest nor a signed-in browser can bypass it with a direct Data API insert.
revoke insert on public.enquiries,public.feedback_submissions,public.property_assistance from public,anon,authenticated;
revoke insert(name,email,phone,message,property_id,preferred_date,kind,consent) on public.enquiries from public,anon,authenticated;
revoke insert(name,email,rating,message,property_id,consent,publish_consent) on public.feedback_submissions from public,anon,authenticated;
revoke insert(property_id,name,email,phone,helper_name,channel,helped_where,helped_on,helped_time,notes,consent) on public.property_assistance from public,anon,authenticated;

create table private.public_intake_limits (
 channel text not null check(channel in ('enquiry','feedback','assistance')),
 client_key text not null check(client_key ~ '^[a-f0-9]{64}$'),
 window_started timestamptz not null,
 requests integer not null check(requests between 1 and 5),
 primary key(channel,client_key)
);
create index public_intake_limits_window_idx on private.public_intake_limits(window_started);
alter table private.public_intake_limits enable row level security;
revoke all on private.public_intake_limits from public,anon,authenticated;
grant usage on schema private to service_role;
grant select,insert,update,delete on private.public_intake_limits to service_role;
create policy intake_limits_service on private.public_intake_limits to service_role using(true) with check(true);
grant insert,select on public.enquiries,public.feedback_submissions,public.property_assistance to service_role;
grant select on public.properties to service_role;

-- Service-only, invoker security. Identity comes from the server's verified
-- Auth response, never from a caller-controlled details field. Reservation and
-- insert commit together, and concurrent instances share the same quota row.
create function public.submit_public_intake(channel text,client_key text,verified_user uuid,details jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare accepted boolean; saved uuid; property uuid;
begin
 if channel is null or channel not in ('enquiry','feedback','assistance') or client_key is null or client_key !~ '^[a-f0-9]{64}$'
  or details is null or jsonb_typeof(details)<>'object' or (details->>'consent')::boolean is distinct from true then
  raise exception 'Invalid submission' using errcode='23514';
 end if;
 property:=nullif(details->>'property_id','')::uuid;
 if property is not null and not exists(select 1 from public.properties p where p.id=property and p.status='published' and p.listing_type='rent' and p.availability in ('available','on_request')) then
  raise exception 'Choose an available rental' using errcode='23514';
 end if;
 if channel='enquiry' and nullif(details->>'preferred_date','')::date < (now() at time zone 'UTC')::date then
  raise exception 'Choose a future viewing date' using errcode='23514';
 end if;
 if channel='assistance' and (details->>'helped_on')::date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
  raise exception 'Choose a valid assistance date' using errcode='23514';
 end if;
 insert into private.public_intake_limits as q values(channel,client_key,now(),1)
 on conflict on constraint public_intake_limits_pkey do update set
  window_started=case when q.window_started<=now()-interval '10 minutes' then now() else q.window_started end,
  requests=case when q.window_started<=now()-interval '10 minutes' then 1 else q.requests+1 end
 where q.window_started<=now()-interval '10 minutes' or q.requests<5
 returning true into accepted;
 if not coalesce(accepted,false) then return null;end if;
 delete from private.public_intake_limits q where q.window_started<now()-interval '7 days';
 if channel='enquiry' then
  insert into public.enquiries(user_id,name,email,phone,message,property_id,preferred_date,kind,consent)
  values(verified_user,details->>'name',details->>'email',coalesce(details->>'phone',''),details->>'message',property,nullif(details->>'preferred_date','')::date,coalesce(details->>'kind','general'),true) returning id into saved;
 elsif channel='feedback' then
  insert into public.feedback_submissions(user_id,name,email,rating,message,property_id,consent,publish_consent)
  values(verified_user,details->>'name',details->>'email',(details->>'rating')::integer,details->>'message',property,true,coalesce((details->>'publish_consent')::boolean,false)) returning id into saved;
 else
  insert into public.property_assistance(user_id,property_id,name,email,phone,helper_name,channel,helped_where,helped_on,helped_time,notes,consent)
  values(verified_user,property,details->>'name',details->>'email',coalesce(details->>'phone',''),details->>'helper_name',details->>'channel',details->>'helped_where',(details->>'helped_on')::date,nullif(details->>'helped_time','')::time,coalesce(details->>'notes',''),true) returning id into saved;
 end if;
 return saved;
end; $$;
revoke all on function public.submit_public_intake(text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.submit_public_intake(text,text,uuid,jsonb) to service_role;

notify pgrst,'reload schema';
commit;
