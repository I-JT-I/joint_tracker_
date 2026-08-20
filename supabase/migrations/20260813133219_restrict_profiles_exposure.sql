-- Prima "Profili visibili a utenti loggati" (qual: true) esponeva TUTTE le colonne di
-- TUTTI i profili a chiunque fosse loggato, incluse reminder_time/reminder_enabled che
-- nessuna funzionalita' usa fuori dal proprietario. Sostituita con una vista che espone
-- solo le colonne davvero necessarie per ricerca amici/classifica (id, username, avatar_url).
create view public.profiles_public
  with (security_invoker = false) as
  select id, username, avatar_url from public.profiles;

grant select on public.profiles_public to authenticated;

drop policy "Profili visibili a utenti loggati" on public.profiles;
