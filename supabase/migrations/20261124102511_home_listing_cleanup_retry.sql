begin;

alter table private.home_listing_deletions
  add column cleanup_lease uuid,
  add column cleanup_lease_until timestamptz,
  add column cleanup_retry_after timestamptz not null default '-infinity',
  add column cleanup_retry_count integer not null default 0;

create function public.home_listing_delete_due() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'jobs',coalesce((select jsonb_agg(q.property_id order by q.requested_at,q.property_id)
      from (select d.property_id,d.requested_at from private.home_listing_deletions d
            where d.cleanup_retry_count<6 and d.cleanup_retry_after<=now()
              and coalesce(d.cleanup_lease_until,'-infinity')<=now()
              and exists(select 1 from private.home_listing_deletion_media m
                         where m.property_id=d.property_id and m.state='pending')
            order by d.requested_at,d.property_id limit 2) q),'[]'::jsonb),
    'overdue',(select count(*) from private.home_listing_deletions d
               where d.requested_at<now()-interval '24 hours'
                 and exists(select 1 from private.home_listing_deletion_media m
                            where m.property_id=d.property_id and m.state in ('pending','review')))
  );
$$;

-- Manual and scheduled requests share a lease. A stopped worker's lease
-- expires before another worker can retry the same batch.
create function public.home_listing_delete_claim(p_property uuid,p_background boolean) returns uuid
language sql volatile security definer set search_path='' as $$
  update private.home_listing_deletions d
  set cleanup_lease=gen_random_uuid(),cleanup_lease_until=now()+interval '2 minutes',
      cleanup_retry_after=now()+interval '1 hour',
      cleanup_retry_count=cleanup_retry_count+case when p_background then 1 else 0 end
  where d.property_id=p_property and coalesce(d.cleanup_lease_until,'-infinity')<=now()
    and (p_background is false or p_background is true and d.cleanup_retry_after<=now() and d.cleanup_retry_count<6)
    and exists(select 1 from private.home_listing_deletion_media m
               where m.property_id=d.property_id and m.state='pending')
  returning cleanup_lease;
$$;

create function public.home_listing_delete_release(p_property uuid,p_lease uuid) returns void
language sql volatile security definer set search_path='' as $$
  update private.home_listing_deletions
    set cleanup_lease=null,cleanup_lease_until=null
    where property_id=p_property and cleanup_lease=p_lease;
$$;

revoke all on function public.home_listing_delete_due(),public.home_listing_delete_claim(uuid,boolean),
  public.home_listing_delete_release(uuid,uuid) from public,anon,authenticated;
grant execute on function public.home_listing_delete_due(),public.home_listing_delete_claim(uuid,boolean),
  public.home_listing_delete_release(uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
