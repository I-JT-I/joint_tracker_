-- Contatore pubblico della landing (/ e /en): "{N}+ sessioni tracciate".
--
-- Ritorna UN SOLO numero: le righe di public.smokes (una per sessione registrata
-- da ciascun utente; una sessione condivisa tra 3 persone conta 3, perche' ognuno
-- l'ha tracciata sul proprio diario), esclusi gli account di test. Nessun ID,
-- nessuna riga, nessun dato per utente o per luogo, nessun conteggio utenti.
--
-- Account di test esclusi (per email, stabile anche se il nickname cambia):
--   - joint.tracker@gmail.com (nickname claude_test): account usato per i test
--     automatici/manuali dell'app.
-- Per escluderne altri in futuro basta aggiungere l'email alla lista.
--
-- SECURITY DEFINER perche' la RLS di smokes limita la lettura alle proprie righe
-- (e anon non ne ha nessuna) e auth.users non e' raggiungibile dal client.
-- search_path vuoto + nomi qualificati, per non dipendere dal search_path del
-- chiamante. Execute solo ad anon: la landing chiama la RPC con la sola chiave
-- publishable, senza sessione.
--
-- Costo: un count(*) su smokes (~1.6k righe a settembre 2026), trascurabile.
-- Se il volume crescesse di ordini di grandezza, sostituirlo con un valore
-- cache aggiornato da un cron invece di contare a ogni visita della landing.

CREATE OR REPLACE FUNCTION public.get_public_stats()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
	select count(*)
	from public.smokes s
	where not exists (
		select 1
		from auth.users u
		where u.id = s.user_id
		  and lower(u.email) in ('joint.tracker@gmail.com')
	);
$function$;

REVOKE ALL ON FUNCTION public.get_public_stats() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_stats() TO anon;
