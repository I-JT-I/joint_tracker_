-- F-09 dall'audit logico del 28/09/2026 (AUDIT_REPORT.md): quota personale delle sessioni condivise.
--
-- Prima: nelle righe di una sessione condivisa my_fumo_grams/my_erba_grams valgono l'INTERA
-- sessione (T) per ogni partecipante (scelta della migration 20260819160000) e le statistiche
-- personali contavano T a testa: 3 persone su un joint da 0,9 g risultavano 0,9 g ciascuna,
-- 2,7 g in tutto. Il saldo "Insieme" (get_shared_balance) invece presuppone che ognuno consumi
-- T/N. Sui dati reali: 4,4 g registrati nelle condivise contavano 10,5 g nelle classifiche.
--
-- Ora: la quota personale di una riga condivisa e' T/N, con N = 1 + numero di elementi di
-- shared_with (i partecipanti al momento della creazione, anche se poi qualcuno ha cancellato
-- la propria riga). I DATI NON CAMBIANO: my_* resta il totale della sessione (lo leggono cosi'
-- get_shared_balance, get_all_friends_shared_stats, get_friends_shared_leaderboard e la mappa di
-- admin_dashboard_stats), cambia solo la lettura "personale". Per tornare indietro basta
-- ripristinare le funzioni, senza toccare i dati.
--
-- Stessa regola in app.js (personalSplit). Righe non condivise: regola invariata.
--
-- * smoke_personal_split: righe condivise -> my_* / N.
-- * get_global_leaderboard, get_friends_leaderboard: totale da smoke_personal_split (prima
--   GREATEST(my, contributo, grams) in linea, che sulle righe non condivise da' lo stesso valore).
-- * get_snapshot_feed: le colonne my_fumo_grams/my_erba_grams ritornano la quota personale
--   (il feed non ha shared_with per ricavarla lato client). Stesso tipo di ritorno.
-- * get_friend_stats: usa gia' smoke_personal_split, nessuna modifica.

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
		       case when s.type = 'erba' then coalesce(s.grams, 0) when s.type = 'fumo-erba' then coalesce(s.grams, 0) / 2 else 0 end as r_e,
		       case when jsonb_typeof(s.shared_with) = 'array' and jsonb_array_length(s.shared_with) > 0
		            then jsonb_array_length(s.shared_with) + 1 else 1 end as n
	)
	select
		case when n > 1 then my_f / n
		     when r_f + r_e > greatest(my_f + my_e, c_f + c_e) then r_f when c_f + c_e > my_f + my_e then c_f else my_f end,
		case when n > 1 then my_e / n
		     when r_f + r_e > greatest(my_f + my_e, c_f + c_e) then r_e when c_f + c_e > my_f + my_e then c_e else my_e end
	from v;
$function$;
REVOKE ALL ON FUNCTION public.smoke_personal_split(public.smokes) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_global_leaderboard()
 RETURNS TABLE(user_id uuid, username text, avatar_url text, total_g numeric, total_j bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
	RETURN QUERY
	SELECT p.id, p.username, p.avatar_url,
		COALESCE(SUM(sp.fumo + sp.erba), 0)::NUMERIC AS total_g,
		COUNT(s.id)::BIGINT AS total_j
	FROM profiles p
	JOIN smokes s ON s.user_id = p.id
	CROSS JOIN LATERAL public.smoke_personal_split(s) sp
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
		COALESCE(SUM(sp.fumo + sp.erba), 0)::NUMERIC AS total_g,
		COUNT(s.id)::BIGINT AS total_j
	FROM profiles p
	LEFT JOIN smokes s ON s.user_id = p.id
	LEFT JOIN LATERAL public.smoke_personal_split(s) sp ON s.id IS NOT NULL
	WHERE p.id = current_user_id
		OR p.id IN (SELECT f.friend_id FROM friendships f WHERE f.user_id = current_user_id AND f.status = 'accepted')
	GROUP BY p.id, p.username, p.avatar_url
	ORDER BY total_g DESC, total_j DESC, lower(p.username), p.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_snapshot_feed(limit_count integer DEFAULT 20)
 RETURNS TABLE(id bigint, user_id uuid, username text, avatar_url text, ts bigint, date date, "time" text, type text, my_fumo_grams numeric, my_erba_grams numeric, location_name text, photo_path text, reaction_summary jsonb, my_reaction text, comment_count integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    s.id, s.user_id, p.username, p.avatar_url,
    s.ts, s.date, s.time, s.type,
    -- quota personale (smoke_personal_split), non il totale grezzo della sessione condivisa
    sp.fumo, sp.erba, s.location_name, s.photo_path,
    public.snapshot_reaction_summary(s.id) as reaction_summary,
    (select r.reaction_type from public.snapshot_reactions r
       where r.snapshot_id = s.id and r.user_id = (select auth.uid())) as my_reaction,
    (select count(*)::int from public.snapshot_comments c where c.snapshot_id = s.id) as comment_count
  from public.smokes s
  cross join lateral public.smoke_personal_split(s) sp
  join public.profiles p on p.id = s.user_id
  where s.photo_path is not null
    and (
      s.user_id = (select auth.uid())
      or s.user_id in (
        select f.friend_id from public.friendships f
        where f.user_id = (select auth.uid()) and f.status = 'accepted'
      )
    )
  order by s.ts desc
  limit limit_count;
$function$;
