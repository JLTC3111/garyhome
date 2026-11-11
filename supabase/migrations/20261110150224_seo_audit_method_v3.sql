begin;
-- New summaries distinguish actual response locales and deduplicated evaluated checks.
-- Existing rows retain their original method version for honest comparisons.
create or replace function public.seo_save_audit(p_run_id uuid,p_lease_token uuid,p_state jsonb,p_summary jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare saved boolean; new_status text:=p_state->>'status';
begin
  if new_status not in ('queued','running','completed','incomplete','failed') or new_status is null then raise exception 'Invalid audit status.' using errcode='23514'; end if;
  update public.seo_audit_runs set state=p_state,status=new_status,
    finished_at=case when new_status in ('completed','incomplete','failed') then now() else null end,
    content_score=(p_summary->>'content_score')::integer,technical_score=(p_summary->>'technical_score')::integer,
    score_basis=case when p_summary->>'score_basis'='evaluated-checks-v3' then 'evaluated-checks-v3' else null end,
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

notify pgrst,'reload schema';
commit;
