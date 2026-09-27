-- Sezione "Insieme" nel popup statistiche amico + hardening delle RPC amici.
--
-- 1) get_shared_balance(p_friend_id, p_since): per le sessioni condivise tra
--    chi chiama (A) e un amico accettato (B), ritorna per Fumo ed Erba:
--    numero sessioni, totale sessione, contributo di A, contributo di B e
--    saldo. Una "sessione condivisa" non ha una tabella propria: e' un insieme
--    di righe `smokes` (una per partecipante) con lo stesso `ts`, create da
--    create_shared_session. Una sessione conta solo se esistono ENTRAMBE le
--    righe di A e di B (chi cancella la propria riga "esce" dalla sessione).
--
--    Significato delle colonne (verificato su UI + RPC di creazione):
--      fumo_grams / erba_grams       = quanto ha PORTATO quel partecipante
--      my_fumo_grams / my_erba_grams = totale della sessione (uguale su ogni riga)
--
--    Saldo (dal punto di vista di A, > 0 = B deve a A):
--      somma su ogni sessione di (contributo_A - contributo_B) / N
--    con N = numero di partecipanti della sessione. Con N = 2 coincide con
--    (cA - cB) / 2; con N > 2 la somma dei saldi a coppie di A e' esattamente
--    la sua posizione netta (contributo - quota T/N), senza sovrastimarla.
--    Simmetrico: B vede lo stesso valore con segno opposto.
--
--    SECURITY DEFINER perche' la RLS di smokes permette di leggere solo le
--    proprie righe e il contributo di B sta sulla riga di B. Ritorna solo
--    aggregati (niente posizione/orari/note delle righe dell'amico). Controlli
--    espliciti: chiamante autenticato, amico diverso da se', amicizia
--    'accepted', solo righe di A e B di sessioni in cui ciascuno e' nel
--    shared_with dell'altro.
--
--    Nessun indice nuovo: si parte dalle righe di A (user_id = auth.uid()) e
--    la riga di B si trova per (user_id, ts) sull'indice unico esistente
--    smokes_user_id_ts_key.
--
--    Righe ritornate: sempre una riga kind='all' (solo `sessions` valorizzato),
--    piu' 'fumo' / 'erba' solo se nel periodo ci sono sessioni con quel tipo.
--    Valori non arrotondati: arrotonda il client (1 decimale come il resto app).

CREATE OR REPLACE FUNCTION public.get_shared_balance(p_friend_id uuid, p_since date DEFAULT NULL)
RETURNS TABLE(kind text, sessions bigint, total numeric, mine numeric, theirs numeric, balance numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
	v_me uuid := auth.uid();
begin
	if v_me is null then
		raise exception 'not authenticated' using errcode = '42501';
	end if;
	if p_friend_id is null or p_friend_id = v_me then
		raise exception 'invalid friend' using errcode = '22023';
	end if;
	if not exists (
		select 1 from public.friendships f
		where f.user_id = v_me and f.friend_id = p_friend_id and f.status = 'accepted'
	) then
		raise exception 'not friends' using errcode = '42501';
	end if;

	return query
	with pairs as (
		select
			greatest(
				case when jsonb_typeof(a.shared_with) = 'array' then jsonb_array_length(a.shared_with) + 1 else 0 end,
				case when jsonb_typeof(b.shared_with) = 'array' then jsonb_array_length(b.shared_with) + 1 else 0 end,
				2
			)::numeric as n,
			coalesce(a.fumo_grams, 0) as a_f,
			coalesce(b.fumo_grams, 0) as b_f,
			coalesce(a.erba_grams, 0) as a_e,
			coalesce(b.erba_grams, 0) as b_e,
			-- totale sessione: my_* e' lo stesso su ogni riga; il greatest con la
			-- somma dei contributi copre righe storiche/ritoccate in cui non torna.
			greatest(coalesce(a.my_fumo_grams, 0), coalesce(b.my_fumo_grams, 0), coalesce(a.fumo_grams, 0) + coalesce(b.fumo_grams, 0)) as tot_f,
			greatest(coalesce(a.my_erba_grams, 0), coalesce(b.my_erba_grams, 0), coalesce(a.erba_grams, 0) + coalesce(b.erba_grams, 0)) as tot_e
		from public.smokes a
		join public.smokes b
			on b.user_id = p_friend_id
			and b.ts = a.ts
		where a.user_id = v_me
			and a.shared_with @> jsonb_build_array(p_friend_id::text)
			and b.shared_with @> jsonb_build_array(v_me::text)
			and (p_since is null or a.date >= p_since)
	)
	select 'all'::text, count(*)::bigint, null::numeric, null::numeric, null::numeric, null::numeric
	from pairs
	union all
	select 'fumo'::text, count(*)::bigint, sum(tot_f), sum(a_f), sum(b_f), sum((a_f - b_f) / n)
	from pairs where tot_f > 0
	having count(*) > 0
	union all
	select 'erba'::text, count(*)::bigint, sum(tot_e), sum(a_e), sum(b_e), sum((a_e - b_e) / n)
	from pairs where tot_e > 0
	having count(*) > 0;
end;
$function$;

REVOKE ALL ON FUNCTION public.get_shared_balance(uuid, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_shared_balance(uuid, date) TO authenticated;


-- 2) get_friend_stats(target_user_id): prima chiunque fosse autenticato poteva
--    leggere i totali fumo/erba di QUALSIASI utente conoscendone l'UUID. Ora
--    solo se stessi o un amico 'accepted'; altrimenti 42501 (il client mostra
--    "statistiche visibili solo agli amici" quando si apre un non-amico dalla
--    classifica mondiale). Corpo e forma del risultato invariati.

CREATE OR REPLACE FUNCTION public.get_friend_stats(target_user_id uuid)
RETURNS TABLE(fumo_g numeric, erba_g numeric, totale_j bigint, username text, avatar_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
	IF auth.uid() IS NULL THEN
		RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
	END IF;
	IF target_user_id IS DISTINCT FROM auth.uid() AND NOT EXISTS (
		SELECT 1 FROM friendships f
		WHERE f.user_id = auth.uid() AND f.friend_id = target_user_id AND f.status = 'accepted'
	) THEN
		RAISE EXCEPTION 'not friends' USING ERRCODE = '42501';
	END IF;

	RETURN QUERY
	SELECT
		COALESCE(SUM(GREATEST(COALESCE(s.my_fumo_grams,0), COALESCE(s.fumo_grams,0), CASE WHEN s.type='fumo' THEN COALESCE(s.grams,0) ELSE 0 END)),0)::NUMERIC,
		COALESCE(SUM(GREATEST(COALESCE(s.my_erba_grams,0), COALESCE(s.erba_grams,0), CASE WHEN s.type='erba' THEN COALESCE(s.grams,0) ELSE 0 END)),0)::NUMERIC,
		COUNT(s.id)::BIGINT,
		(SELECT p.username FROM profiles p WHERE p.id = target_user_id),
		(SELECT p.avatar_url FROM profiles p WHERE p.id = target_user_id)
	FROM smokes s
	WHERE s.user_id = target_user_id;
END;
$function$;


-- 3) get_friends_leaderboard(current_user_id): il parametro era fidato, quindi
--    chiunque poteva leggere la classifica amici (totali inclusi) di un altro
--    utente. Firma invariata per compatibilita' col client (che passa il
--    proprio id), ma ora deve coincidere con auth.uid().

CREATE OR REPLACE FUNCTION public.get_friends_leaderboard(current_user_id uuid)
RETURNS TABLE(user_id uuid, username text, avatar_url text, total_g numeric, total_j bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
	IF auth.uid() IS NULL OR current_user_id IS DISTINCT FROM auth.uid() THEN
		RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
	END IF;

	RETURN QUERY
	SELECT p.id AS user_id, p.username, p.avatar_url,
		COALESCE(SUM(GREATEST(
			COALESCE(s.my_fumo_grams, 0) + COALESCE(s.my_erba_grams, 0),
			COALESCE(s.fumo_grams, 0) + COALESCE(s.erba_grams, 0),
			COALESCE(s.grams, 0))), 0)::NUMERIC AS total_g,
		COUNT(s.id)::BIGINT AS total_j
	FROM profiles p
	LEFT JOIN smokes s ON s.user_id = p.id
	WHERE p.id = current_user_id
		OR p.id IN (SELECT f.friend_id FROM friendships f WHERE f.user_id = current_user_id AND f.status = 'accepted')
	GROUP BY p.id, p.username, p.avatar_url
	ORDER BY total_g DESC;
END;
$function$;


-- 4) Rimuove i due overload obsoleti di create_shared_session (7 e 9 argomenti),
--    ancora eseguibili da `authenticated` e con il vecchio bug che scriveva
--    my_*_grams = contributo. Il client usa solo la versione a 10 argomenti.

DROP FUNCTION IF EXISTS public.create_shared_session(date, text, bigint, numeric, numeric, text, jsonb);
DROP FUNCTION IF EXISTS public.create_shared_session(date, text, bigint, numeric, numeric, text, jsonb, text, smallint);
