begin;
alter table public.seo_audit_runs add column score_basis text;
alter table public.seo_audit_runs add column coverage jsonb;
-- Legacy cached scores intentionally remain unversioned. They must not enter
-- trend comparisons with the new evidence-only, check-weighted calculation.
create or replace function public.seo_save_audit(p_run_id uuid,p_lease_token uuid,p_state jsonb,p_summary jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare saved boolean; new_status text:=p_state->>'status';
begin
  if new_status not in ('queued','running','completed','incomplete','failed') or new_status is null then raise exception 'Invalid audit status.' using errcode='23514'; end if;
  update public.seo_audit_runs set state=p_state,status=new_status,
    finished_at=case when new_status in ('completed','incomplete','failed') then now() else null end,
    content_score=(p_summary->>'content_score')::integer,technical_score=(p_summary->>'technical_score')::integer,
    score_basis=case when p_summary->>'score_basis'='evaluated-checks-v2' then 'evaluated-checks-v2' else null end,
    coverage=p_summary->'coverage',
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

create function public.seo_resume_audit(p_run_id uuid,p_state jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.seo_audit_runs;
begin
  perform 1 from public.seo_audit_settings where id=true for update;
  if exists(select 1 from public.seo_audit_runs where status in ('queued','running')) then return null; end if;
  select * into run from public.seo_audit_runs where id=p_run_id for update;
  if not found or run.status not in ('failed','incomplete') then return null; end if;
  if p_state->>'status' is distinct from 'queued' then raise exception 'Resumed audits must be queued.' using errcode='23514'; end if;
  update public.seo_audit_runs set state=p_state,status='queued',finished_at=null,lease_token=null,lease_until=null,
    content_score=null,technical_score=null,score_basis=null,coverage=null
    where id=p_run_id returning * into run;
  return to_jsonb(run);
end;
$$;
revoke all on function public.seo_resume_audit(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.seo_resume_audit(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
