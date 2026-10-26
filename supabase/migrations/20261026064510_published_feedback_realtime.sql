begin;
-- Broadcast only the sanitized, consented and moderated public copy. Private
-- submissions, email addresses and customer account IDs are never published.
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='feedback_public') then
  alter publication supabase_realtime add table public.feedback_public;
 end if;
end;$$;
commit;
