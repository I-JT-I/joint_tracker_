-- NOTA: il valore reale di CRON_SECRET e' stato redatto qui per non committarlo in chiaro
-- nella history git. Il job pg_cron sul database remoto contiene gia' il valore effettivo;
-- questo file serve solo a tenere lo storico migration allineato, non va ri-eseguito cosi'.
select cron.alter_job(
  job_id := 1,
  command := $$
  select net.http_post(
    url := 'https://afkxmbxcavwhurmdelfr.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET_REDACTED>'),
    body := '{}'::jsonb
  );
  $$
);

select cron.alter_job(
  job_id := 2,
  command := $$
  select net.http_post(
    url := 'https://afkxmbxcavwhurmdelfr.supabase.co/functions/v1/weekly-backup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET_REDACTED>'),
    body := '{}'::jsonb
  );
  $$
);

select cron.alter_job(
  job_id := 4,
  command := $$
  select net.http_post(
    url := 'https://afkxmbxcavwhurmdelfr.supabase.co/functions/v1/check-low-stock',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET_REDACTED>'),
    body := '{}'::jsonb
  );
  $$
);
