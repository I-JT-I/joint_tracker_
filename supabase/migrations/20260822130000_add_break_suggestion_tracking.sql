-- Tracking per il suggerimento proattivo di pausa (consumo sostenuto moderato/pesante
-- per N giorni consecutivi -> avviso in-app, ripetuto al massimo ogni M giorni se ignorato).
-- Applicata in produzione via Supabase MCP il 2026-08-22.
alter table user_stats
  add column elevated_since date,
  add column last_break_suggestion_at timestamptz;
