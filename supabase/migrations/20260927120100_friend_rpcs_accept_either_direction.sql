-- Follow-up di 20260927120000: in produzione 8 amicizie 'accepted' su 10 esistono
-- in UNA sola direzione (amicizie storiche, create prima del flusso richiesta/
-- accettazione; respond_friend_request oggi scrive entrambe le righe). Il controllo
-- "f.user_id = auth.uid()" bloccava quindi uno dei due lati: niente popup
-- statistiche e niente sezione "Insieme" per lui, e il saldo non era piu'
-- simmetrico. Ora basta una riga 'accepted' in una qualsiasi delle due direzioni.
-- Gli estranei (nessuna riga, o solo 'pending') restano bloccati con 42501.

CREATE OR REPLACE FUNCTION public.are_accepted_friends(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
	select exists (
		select 1 from public.friendships f
		where f.status = 'accepted'
			and ((f.user_id = p_a and f.friend_id = p_b) or (f.user_id = p_b and f.friend_id = p_a))
	);
$function$;

-- helper interno: lo chiamano solo le RPC SECURITY DEFINER qui sotto
REVOKE ALL ON FUNCTION public.are_accepted_friends(uuid, uuid) FROM public, anon, authenticated;

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
	if not public.are_accepted_friends(v_me, p_friend_id) then
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
	IF target_user_id IS DISTINCT FROM auth.uid() AND NOT public.are_accepted_friends(auth.uid(), target_user_id) THEN
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
