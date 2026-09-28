-- Scheduled jobs. They read the project URL and anon key from Vault, so set these ONCE first
-- (SQL editor, replace values):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<anon key>', 'anon_key');
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.call_function(fn text) returns bigint language sql security definer set search_path = public as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/' || fn,
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')),
    body := '{}'::jsonb);
$$;
revoke all on function public.call_function(text) from anon, authenticated, public;

select cron.schedule('process-fees', '*/10 * * * *', $$ select public.call_function('process-fees') $$);
select cron.schedule('email-jobs',   '*/10 * * * *', $$ select public.call_function('email-jobs') $$);

-- Close grants automatically once their deadline has passed (runs daily at 00:05 UTC).
select cron.schedule('close-expired-grants', '5 0 * * *', $$
  update public.grants set window_state = 'closed', updated_at = now()
  where window_state = 'open' and closes is not null and closes < (now() at time zone 'Europe/Madrid')::date
$$);
