-- Presidio 24 ore su 24: Supabase chiama l'app ogni 5 minuti.
-- 1) Sostituisci APP_URL e CRON_SECRET con i tuoi valori (gli stessi delle variabili d'ambiente su Vercel).
-- 2) Esegui nello SQL Editor di Supabase.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'trading-advisor-tick',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://APP_URL/api/cron/tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'CRON_SECRET'),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);

-- Per fermare il presidio:  select cron.unschedule('trading-advisor-tick');
