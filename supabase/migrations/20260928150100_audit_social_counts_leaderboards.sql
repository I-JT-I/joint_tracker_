-- Fix dall'audit logico del 28/09/2026 (AUDIT_REPORT.md: F-04, F-10, F-23, F-24).
--
-- test_account_ids(): unica lista degli account di test, usata da classifica mondiale,
-- contatore pubblico e dashboard admin (prima solo get_public_stats li escludeva).
--
-- "Sessioni insieme": classifica Amici ("👥 N insieme") e tab Insieme contavano solo le
-- righe di chi chiama, il popup "Insieme" (get_shared_balance) solo le coppie in cui
-- esistono ENTRAMBE le righe con lo stesso ts. Se un partecipante eliminava la propria
-- riga i numeri divergevano (14 e 15 contro 13 per la stessa coppia). Ora tutte e tre
-- usano lo stesso join a coppie e gli stessi grammi (totale della sessione, Fumo + Erba).
-- Mese della tab Insieme calcolato in Europe/Rome.
--
-- get_global_leaderboard: esclusi account di test e profili senza sessioni; pareggi
-- ordinati in modo stabile. get_friends_leaderboard: stesso tie-break.
--
-- get_friend_stats: ripartizione Fumo/Erba con la stessa regola del client
-- (personalSplit in app.js), cosi' fumo + erba del popup = totale della classifica.
--
-- set_snapshot_reaction: la notifica aggregata si incrementa solo quando nasce una
-- reazione nuova, non a ogni cambio di tipo (❤️ -> 🔥 contava "2 reazioni").

CREATE OR REPLACE FUNCTION public.test_account_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
	select u.id from auth.users u where lower(u.email) in ('joint.tracker@gmail.com');
$function$;
REVOKE ALL ON FUNCTION public.test_account_ids() FROM public, anon, authenticated;

-- Grammi personali di una riga smokes, stessa regola di personalSplit() in app.js:
-- vince la lettura (my_*, contributo, grams per tipo) con il totale maggiore.
CREATE OR REPLACE FUNCTION public.smoke_personal_split(s public.smokes)
 RETURNS TABLE(fumo numeric, erba numeric)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
	with v as (
		select coalesce(s.my_fumo_grams, 0) as my_f, coalesce(s.my_erba_grams, 0) as my_e,
		       coalesce(s.fumo_grams, 0) as c_f, coalesce(s.erba_grams, 0) as c_e,
		       case when s.type = 'erba' then 0 when s.type = 'fumo-erba' then coalesce(s.grams, 0) / 2 else coalesce(s.grams, 0) end as r_f,
		       case when s.type = 'erba' then coalesce(s.grams, 0) when s.type = 'fumo-erba' then coalesce(s.grams, 0) / 2 else 0 end as r_e
	)
	select
		case when r_f + r_e > greatest(my_f + my_e, c_f + c_e) then r_f when c_f + c_e > my_f + my_e then c_f else my_f end,
		case when r_f + r_e > greatest(my_f + my_e, c_f + c_e) then r_e when c_f + c_e > my_f + my_e then c_e else my_e end
	from v;
$function$;
-- interna: la usano solo RPC SECURITY DEFINER (esposta, PostgREST la tratterebbe come colonna calcolata)
REVOKE ALL ON FUNCTION public.smoke_personal_split(public.smokes) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_all_friends_shared_stats()
 RETURNS TABLE(friend_id uuid, sessions_together bigint, grams_together numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
	with pairs as (
		select b.user_id as fid,
		       greatest(coalesce(a.my_fumo_grams, 0), coalesce(b.my_fumo_grams, 0), coalesce(a.fumo_grams, 0) + coalesce(b.fumo_grams, 0))
		     + greatest(coalesce(a.my_erba_grams, 0), coalesce(b.my_erba_grams, 0), coalesce(a.erba_grams, 0) + coalesce(b.erba_grams, 0)) as tot
		from public.smokes a
		join public.smokes b on b.ts = a.ts and b.user_id <> a.user_id
		where a.user_id = auth.uid()
			and a.shared_with @> jsonb_build_array(b.user_id::text)
			and b.shared_with @> jsonb_build_array(a.user_id::text)
	)
	select f.friend_id, count(p.fid), coalesce(sum(p.tot), 0)
	from public.friendships f
	left join pairs p on p.fid = f.friend_id
	where f.user_id = auth.uid() and f.status = 'accepted'
	group by f.friend_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_friends_shared_leaderboard(period text DEFAULT 'month'::text)
 RETURNS TABLE(friend_id uuid, username text, avatar_url text, sessions_together bigint, grams_together numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
	with pairs as (
		select b.user_id as fid,
		       greatest(coalesce(a.my_fumo_grams, 0), coalesce(b.my_fumo_grams, 0), coalesce(a.fumo_grams, 0) + coalesce(b.fumo_grams, 0))
		     + greatest(coalesce(a.my_erba_grams, 0), coalesce(b.my_erba_grams, 0), coalesce(a.erba_grams, 0) + coalesce(b.erba_grams, 0)) as tot
		from public.smokes a
		join public.smokes b on b.ts = a.ts and b.user_id <> a.user_id
		where a.user_id = auth.uid()
			and a.shared_with @> jsonb_build_array(b.user_id::text)
			and b.shared_with @> jsonb_build_array(a.user_id::text)
			and (period <> 'month' or a.date >= date_trunc('month', (now() at time zone 'Europe/Rome'))::date)
	)
	select f.friend_id, p.username, p.avatar_url, count(x.fid), coalesce(sum(x.tot), 0)
	from public.friendships f
	join public.profiles p on p.id = f.friend_id
	left join pairs x on x.fid = f.friend_id
	where f.user_id = auth.uid() and f.status = 'accepted'
	group by f.friend_id, p.username, p.avatar_url
	order by 4 desc, 5 desc, lower(p.username);
$function$;

CREATE OR REPLACE FUNCTION public.get_global_leaderboard()
 RETURNS TABLE(user_id uuid, username text, avatar_url text, total_g numeric, total_j bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
	RETURN QUERY
	SELECT p.id, p.username, p.avatar_url,
		COALESCE(SUM(GREATEST(
			COALESCE(s.my_fumo_grams, 0) + COALESCE(s.my_erba_grams, 0),
			COALESCE(s.fumo_grams, 0) + COALESCE(s.erba_grams, 0),
			COALESCE(s.grams, 0))), 0)::NUMERIC AS total_g,
		COUNT(s.id)::BIGINT AS total_j
	FROM profiles p
	JOIN smokes s ON s.user_id = p.id
	WHERE p.id NOT IN (SELECT public.test_account_ids())
	GROUP BY p.id, p.username, p.avatar_url
	ORDER BY total_g DESC, total_j DESC, lower(p.username), p.id;
END;
$function$;

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
	ORDER BY total_g DESC, total_j DESC, lower(p.username), p.id;
END;
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
		COALESCE(SUM(sp.fumo), 0)::NUMERIC,
		COALESCE(SUM(sp.erba), 0)::NUMERIC,
		COUNT(s.id)::BIGINT,
		(SELECT p.username FROM profiles p WHERE p.id = target_user_id),
		(SELECT p.avatar_url FROM profiles p WHERE p.id = target_user_id)
	FROM smokes s
	CROSS JOIN LATERAL public.smoke_personal_split(s) sp
	WHERE s.user_id = target_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_snapshot_reaction(p_snapshot_id bigint, p_reaction_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_owner uuid; v_inserted boolean;
begin
  if p_reaction_type not in ('heart','fire','joy','wow','clap') then
    raise exception 'Invalid reaction type: %', p_reaction_type;
  end if;
  select user_id into v_owner from public.smokes where id = p_snapshot_id and photo_path is not null;
  if v_owner is null or not public.can_see_snapshot(p_snapshot_id) then
    raise exception 'Not allowed to react to this snapshot' using errcode = '42501';
  end if;
  insert into public.snapshot_reactions (snapshot_id, user_id, reaction_type)
  values (p_snapshot_id, (select auth.uid()), p_reaction_type)
  on conflict (snapshot_id, user_id)
  do update set reaction_type = excluded.reaction_type, created_at = now()
  returning (xmax = 0) into v_inserted;
  -- solo una reazione NUOVA incrementa la notifica: cambiare tipo non e' un nuovo evento
  if v_inserted and v_owner <> (select auth.uid()) then
    perform public.notify_snapshot_engagement(v_owner, 'snapshot_reaction', p_snapshot_id);
  end if;
  return public.snapshot_reaction_summary(p_snapshot_id);
end $function$;

REVOKE ALL ON FUNCTION public.get_all_friends_shared_stats() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_all_friends_shared_stats() TO authenticated;
REVOKE ALL ON FUNCTION public.get_friends_shared_leaderboard(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_friends_shared_leaderboard(text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_global_leaderboard() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_global_leaderboard() TO authenticated;
REVOKE ALL ON FUNCTION public.get_friends_leaderboard(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_friends_leaderboard(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_friend_stats(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_friend_stats(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.set_snapshot_reaction(bigint, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_snapshot_reaction(bigint, text) TO authenticated;
