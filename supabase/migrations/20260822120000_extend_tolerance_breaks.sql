-- Estende tolerance_breaks per il sistema completo (auto-detection, pianificazione,
-- tentativi non completati, tracking notifiche milestone/check-in, edit manuale).
-- Applicata in produzione via Supabase MCP il 2026-08-22.
alter table tolerance_breaks
  add column origin text not null default 'auto' check (origin in ('auto','planned')),
  add column planned_start_date date,
  add column confirmed_at timestamptz,
  add column attempted boolean not null default false,
  add column notified_milestones integer[] not null default '{}',
  add column last_checkin_notified_day integer,
  add column manually_edited boolean not null default false;

-- Le righe esistenti erano tutte create manualmente e attive/concluse fin da subito:
-- confirmed_at = created_at le tratta come "auto" già confermate, coerente col nuovo stato.
update tolerance_breaks set confirmed_at = created_at where confirmed_at is null;
