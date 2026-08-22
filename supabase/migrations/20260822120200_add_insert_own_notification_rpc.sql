-- notifications non ha una policy INSERT per gli utenti normali (le notifiche cross-utente
-- passano già da funzioni SECURITY DEFINER dedicate, vedi CLAUDE.md). Per le notifiche
-- in-app di tolerance break (milestone CB1 / check-in) l'utente deve poter inserire
-- notifiche solo per se stesso: stessa convenzione, nuova funzione dedicata invece di
-- allargare la RLS a un INSERT generico. Applicata in produzione via Supabase MCP il 2026-08-22.
create or replace function insert_own_notification(p_type text, p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (user_id, type, message)
  values (auth.uid(), p_type, p_message);
end;
$$;

revoke all on function insert_own_notification(text, text) from public;
grant execute on function insert_own_notification(text, text) to authenticated;
