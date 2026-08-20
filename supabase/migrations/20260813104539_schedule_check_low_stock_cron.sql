select cron.schedule(
  'check-low-stock-daily',
  '0 8 * * *',
  $$
  select net.http_post(
    url := 'https://afkxmbxcavwhurmdelfr.supabase.co/functions/v1/check-low-stock',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
