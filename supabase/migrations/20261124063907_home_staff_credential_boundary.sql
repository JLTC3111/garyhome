begin;

-- Retire the legacy temporary-password RPC while retaining reminder and audit
-- history. Self-service password changes still clear a user's own reminder.
revoke all on function public.staff_temporary_password_request(uuid,boolean),
  private.staff_temporary_password_request(uuid,boolean) from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
