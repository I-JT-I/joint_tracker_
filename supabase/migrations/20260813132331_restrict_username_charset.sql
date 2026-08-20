-- Gli username finiscono in innerHTML in decine di punti dell'app (classifica, notifiche,
-- richieste di amicizia, istantanee) senza escape. Senza questo vincolo, chiunque potrebbe
-- registrare uno username contenente HTML/script ed eseguirlo nel browser di chi lo vede.
-- Nessuno username esistente viola questo pattern (verificato prima di applicarlo).
alter table public.profiles
  add constraint profiles_username_safe_chars
  check (username !~ '[<>"''`&]');
