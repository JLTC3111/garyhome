begin;

-- Crawl state is server-owned. Authenticated staff may inspect reports, but
-- cannot enqueue work or forge results through the Data API.
create table public.seo_audit_settings (
  id boolean primary key default true check (id),
  weekly_enabled boolean not null default false,
  next_run_at timestamptz not null default now(),
  limits jsonb not null default '{"maxUrls":500,"maxDepth":4,"concurrency":2,"requestIntervalMs":1000,"timeoutMs":10000,"maxDurationMs":900000}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint seo_audit_limits_object check (jsonb_typeof(limits)='object')
);
insert into public.seo_audit_settings(id) values(true);
create table public.seo_audit_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'queued' check(status in ('queued','running','completed','incomplete','failed')),
  scope text not null check(scope in ('site','page')),
  trigger text not null check(trigger in ('manual','weekly','page')),
  target_url text,
  actor_id uuid references auth.users(id) on delete set null,
  state jsonb not null check(jsonb_typeof(state)='object'),
  content_score integer check(content_score between 0 and 100),
  technical_score integer check(technical_score between 0 and 100),
  page_count integer not null default 0 check(page_count between 0 and 1000),
  critical_count integer not null default 0 check(critical_count>=0),
  lease_token uuid,
  lease_until timestamptz
);
create unique index seo_audit_single_active on public.seo_audit_runs ((true)) where status in ('queued','running');
create index seo_audit_history on public.seo_audit_runs(created_at desc);
alter table public.seo_audit_settings enable row level security;
alter table public.seo_audit_runs enable row level security;
revoke all on public.seo_audit_settings,public.seo_audit_runs from public,anon,authenticated;
grant select on public.seo_audit_settings,public.seo_audit_runs to authenticated;
grant all on public.seo_audit_settings,public.seo_audit_runs to service_role;
create policy seo_settings_staff_read on public.seo_audit_settings for select to authenticated using ((select private.is_editor()));
create policy seo_runs_staff_read on public.seo_audit_runs for select to authenticated using ((select private.is_editor()));

-- All worker RPCs are invokers, service-role only. The singleton row lock
-- serializes manual starts with scheduler starts across serverless instances.
create function public.seo_create_audit(p_state jsonb,p_trigger text,p_scope text,p_target_url text default null,p_actor_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare settings public.seo_audit_settings; run public.seo_audit_runs;
begin
  select * into settings from public.seo_audit_settings where id=true for update;
  select * into run from public.seo_audit_runs where status in ('queued','running') limit 1;
  if found then return to_jsonb(run); end if;
  if p_trigger='weekly' and (not settings.weekly_enabled or settings.next_run_at>now()) then return null; end if;
  if p_state->>'status' is distinct from 'queued' then raise exception 'New audits must be queued.' using errcode='23514'; end if;
  insert into public.seo_audit_runs(state,trigger,scope,target_url,actor_id)
    values(p_state,p_trigger,p_scope,p_target_url,p_actor_id) returning * into run;
  if p_trigger='weekly' then update public.seo_audit_settings set next_run_at=now()+interval '7 days',updated_at=now() where id=true; end if;
  delete from public.seo_audit_runs where id in (select id from public.seo_audit_runs order by created_at desc,id desc offset 20) and status not in ('queued','running');
  return to_jsonb(run);
end;
$$;
create function public.seo_claim_audit(p_run_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.seo_audit_runs;
begin
  select * into run from public.seo_audit_runs
    where status in ('queued','running') and (p_run_id is null or id=p_run_id)
      and (lease_until is null or lease_until<now())
    order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.seo_audit_runs set status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds' where id=run.id returning * into run;
  return to_jsonb(run);
end;
$$;
create function public.seo_save_audit(p_run_id uuid,p_lease_token uuid,p_state jsonb,p_summary jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare saved boolean; new_status text:=p_state->>'status';
begin
  if new_status not in ('queued','running','completed','incomplete','failed') or new_status is null then raise exception 'Invalid audit status.' using errcode='23514'; end if;
  update public.seo_audit_runs set state=p_state,status=new_status,
    finished_at=case when new_status in ('completed','incomplete','failed') then now() else null end,
    content_score=(p_summary->>'content_score')::integer,technical_score=(p_summary->>'technical_score')::integer,
    page_count=(p_summary->>'page_count')::integer,critical_count=(p_summary->>'critical_count')::integer,
    lease_token=null,lease_until=null
    where id=p_run_id and lease_token=p_lease_token and lease_until>=now() and status in ('queued','running');
  saved:=found;
  if saved then
    delete from public.seo_audit_runs where id in (select id from public.seo_audit_runs order by created_at desc,id desc offset 20) and status not in ('queued','running');
  end if;
  return saved;
end;
$$;
revoke all on function public.seo_create_audit(jsonb,text,text,text,uuid),public.seo_claim_audit(uuid),public.seo_save_audit(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.seo_create_audit(jsonb,text,text,text,uuid),public.seo_claim_audit(uuid),public.seo_save_audit(uuid,uuid,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
