-- Manual production operation after WebP checkpoint, delivery and audit verification.
-- Enable Supabase Cron and pg_net first. Store the matching, dedicated
-- HOME_MEDIA_CRON_SECRET in Edge secrets and Vault as gary_home_media_cron_secret.
begin;

do $$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='gary_home_media_cron_secret'
    and nullif(decrypted_secret,'') is not null) then
    raise exception 'Gary Home cleanup scheduler credential is missing';
  end if;
  if not exists(select 1 from private.home_media_control where singleton and permanent_enabled) then
    raise exception 'Gary Home permanent cleanup has not been approved for activation';
  end if;
end;
$$;

select cron.schedule('gary-home-media-expiry','7 * * * *',$job$
  select net.http_post(
    url := 'https://duyiihsmaqfgwezmsnjs.supabase.co/functions/v1/media-orphan-cleanup',
    headers := jsonb_build_object(
      'Content-Type','application/json','x-gary-home-cleanup',
      (select decrypted_secret from vault.decrypted_secrets where name='gary_home_media_cron_secret')
    ),
    body := '{"action":"run"}'::jsonb, timeout_milliseconds := 65000
  )
$job$);

commit;
