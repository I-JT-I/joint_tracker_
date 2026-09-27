-- Titolo "Lo scroccone": l'amico che, dal punto di vista di chi chiama, gli deve
-- piu' grammi nelle sessioni condivise fatte insieme (periodo: sempre, Fumo + Erba
-- sommati). Mostrato accanto al nickname nella classifica (tab Amici e Insieme) e
-- nel popup statistiche amico.
--
-- Per non duplicare la logica del saldo chiama get_shared_balance(amico, null)
-- per ogni amico accettato con cui esiste almeno una sessione condivisa: il
-- numero coincide per costruzione con quello della sezione "Insieme". Gli amici
-- sono pochi (decine al massimo) e ogni chiamata usa l'indice (user_id, ts).
--
-- Ritorna al massimo una riga (friend_id, owed). Nessuna riga se nessuno deve
-- almeno 0.05 g (sotto quella soglia la sezione "Insieme" dice "Siete pari").
-- A parita' vince il primo in ordine di friend_id, per stabilita'.
--
-- SECURITY DEFINER per lo stesso motivo di get_shared_balance (legge le righe
-- smokes degli amici); usa solo dati di sessioni a cui ha partecipato chi chiama.

CREATE OR REPLACE FUNCTION public.get_scroccone()
RETURNS TABLE(friend_id uuid, owed numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
	v_me uuid := auth.uid();
	v_friend uuid;
	v_owed numeric;
	best_id uuid := null;
	best_owed numeric := 0;
begin
	if v_me is null then
		raise exception 'not authenticated' using errcode = '42501';
	end if;

	for v_friend in
		select distinct case when fr.user_id = v_me then fr.friend_id else fr.user_id end as fid
		from public.friendships fr
		where fr.status = 'accepted'
			and (fr.user_id = v_me or fr.friend_id = v_me)
			and fr.user_id <> fr.friend_id
			and exists (
				select 1 from public.smokes s
				where s.user_id = v_me
					and s.shared_with @> jsonb_build_array((case when fr.user_id = v_me then fr.friend_id else fr.user_id end)::text)
			)
		order by 1
	loop
		select coalesce(sum(g.balance), 0) into v_owed
		from public.get_shared_balance(v_friend, null) g
		where g.kind <> 'all';

		if v_owed >= 0.05 and (best_id is null or v_owed > best_owed) then
			best_id := v_friend;
			best_owed := v_owed;
		end if;
	end loop;

	if best_id is not null then
		friend_id := best_id;
		owed := best_owed;
		return next;
	end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.get_scroccone() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_scroccone() TO authenticated;
