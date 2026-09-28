-- Fix dall'audit logico del 28/09/2026 (AUDIT_REPORT.md: F-21, F-22).
--
-- Definizioni uniche per dashboard admin e contatore pubblico della landing:
-- * account di test esclusi ovunque (test_account_ids(), prima solo nel contatore);
-- * "sessione" = sessione distinta: le righe di una sessione condivisa (una per
--   partecipante, stesso ts) contano UNA volta. Prima la landing contava righe (una
--   condivisa a 3 = 3) e l'admin righe senza not_mine: 1568 contro 1491 contro 1565 reali;
-- * date "di oggi" in Europe/Rome, non in UTC;
-- * DAU/MAU = utenti che hanno inserito LORO una sessione nella finestra (created_by =
--   user_id; sulle righe storiche senza created_by si escludono le righe not_mine di una
--   condivisa): chi e' stato solo aggiunto a una condivisa da un amico non e' "attivo";
-- * media sessioni per utente ATTIVO (con almeno una sessione), non su tutti gli iscritti;
-- * streak con le stesse regole del client (sessioni not_mine incluse, oggi o ieri);
-- * adozione "shared session" solo dalle sessioni davvero condivise (not_mine da solo
--   non implica una condivisa); "in classifica" = presenti nella classifica mondiale
--   (utente reale con almeno una sessione);
-- * mappa: una riga per sessione distinta, con i grammi della sessione (prima le condivise
--   pesavano N volte e i grammi erano il solo contributo alla scorta).
-- La forma del JSON restituito e' invariata (admin.html legge le stesse chiavi; in piu'
-- session_locations[].session_grams).

CREATE OR REPLACE FUNCTION public.get_public_stats()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
	select count(distinct case
		when jsonb_typeof(s.shared_with) = 'array' and jsonb_array_length(s.shared_with) > 0 then 'ts:' || s.ts::text
		else 'id:' || s.id::text end)
	from public.smokes s
	where s.user_id not in (select public.test_account_ids());
$function$;

REVOKE ALL ON FUNCTION public.get_public_stats() FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_stats() TO anon;

CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
	v_total_users int;
	v_today date := (now() at time zone 'Europe/Rome')::date;
	result jsonb;
begin
	if coalesce(auth.jwt() ->> 'email', '') <> 'poggi.matteo.2005@gmail.com' then
		raise exception 'not authorized' using errcode = '42501';
	end if;

	select count(*) into v_total_users
	from auth.users where deleted_at is null and id not in (select public.test_account_ids());

	with
	real_users as (
		select u.id, u.created_at, u.email
		from auth.users u
		where u.deleted_at is null and u.id not in (select public.test_account_ids())
	),
	real_smokes as (
		select s.*,
		       case when jsonb_typeof(s.shared_with) = 'array' and jsonb_array_length(s.shared_with) > 0
		            then 'ts:' || s.ts::text else 'id:' || s.id::text end as session_key,
		       -- inserita dal proprietario: created_by = user_id. Righe precedenti a created_by
		       -- (NULL): esclusa la riga di un partecipante not_mine di una condivisa (l'euristica
		       -- di prima), perche' quasi sempre e' stata scritta da chi ha creato la sessione.
		       (s.created_by = s.user_id
		        or (s.created_by is null and not (coalesce(s.not_mine, false)
		            and jsonb_typeof(s.shared_with) = 'array' and jsonb_array_length(s.shared_with) > 0))) as self_created
		from public.smokes s
		join real_users ru on ru.id = s.user_id
	),
	user_days as (
		select distinct user_id, date as d from real_smokes
	),
	islands as (
		select user_id, d,
		       d - (row_number() over (partition by user_id order by d))::int as grp
		from user_days
	),
	current_run as (
		select i.user_id, count(*) as run_len, max(i.d) as last_day
		from islands i
		where i.grp = (
			select i2.grp from islands i2
			where i2.user_id = i.user_id
			order by i2.d desc
			limit 1
		)
		group by i.user_id
	),
	user_streak as (
		select ru.id as user_id,
		       case when cr.last_day is null or cr.last_day < v_today - 1
		            then 0 else cr.run_len end as streak
		from real_users ru
		left join current_run cr on cr.user_id = ru.id
	),
	streak_buckets as (
		select
			count(*) filter (where streak = 0)             as zero,
			count(*) filter (where streak between 1 and 7)  as d1_7,
			count(*) filter (where streak between 8 and 30) as d8_30,
			count(*) filter (where streak >= 31)            as d31_plus
		from user_streak
	),
	day_series as (
		select generate_series(v_today - 29, v_today, interval '1 day')::date as day
	),
	signups_g as (
		select (created_at at time zone 'Europe/Rome')::date as day, count(*) as c
		from real_users
		where (created_at at time zone 'Europe/Rome')::date >= v_today - 29
		group by 1
	),
	signups_by_day as (
		select jsonb_agg(
			jsonb_build_object('day', to_char(ds.day, 'YYYY-MM-DD'), 'count', coalesce(s.c, 0))
			order by ds.day
		) as arr
		from day_series ds left join signups_g s on s.day = ds.day
	),
	sessions_g as (
		select date as day, count(distinct session_key) as c
		from real_smokes
		where date >= v_today - 29 and date <= v_today
		group by 1
	),
	sessions_by_day as (
		select jsonb_agg(
			jsonb_build_object('day', to_char(ds.day, 'YYYY-MM-DD'), 'count', coalesce(s.c, 0))
			order by ds.day
		) as arr
		from day_series ds left join sessions_g s on s.day = ds.day
	),
	per_user as (
		select user_id, count(*) as n from real_smokes group by user_id
	),
	shared_users as (
		select distinct user_id from real_smokes
		where jsonb_typeof(shared_with) = 'array' and jsonb_array_length(shared_with) > 0
	),
	break_users as (
		select distinct b.user_id from public.tolerance_breaks b join real_users ru on ru.id = b.user_id
	),
	leaderboard_users as (
		select distinct s.user_id
		from real_smokes s
		join public.profiles p on p.id = s.user_id
	),
	recent as (
		select ru.id, ru.created_at, p.username,
		       (select count(*) from real_smokes s where s.user_id = ru.id) as session_count
		from real_users ru
		left join public.profiles p on p.id = ru.id
		order by ru.created_at desc
		limit 20
	),
	recent_json as (
		select jsonb_agg(
			jsonb_build_object(
				'created_at', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
				'username', username,
				'session_count', session_count
			) order by created_at desc
		) as arr
		from recent
	),
	logged as (
		select s.*,
		       (case when s.time ~ '^\d{1,2}:\d{2}'
		             then (s.date + s.time::time)
		             else s.date::timestamp end) as logged_at
		from real_smokes s
	),
	recent_sessions as (
		select jsonb_agg(
			(to_jsonb(l) - 'logged_at' - 'session_key' - 'self_created') || jsonb_build_object(
				'logged_at', to_char(l.logged_at, 'YYYY-MM-DD"T"HH24:MI:SS'),
				'username', p.username,
				'email', u.email
			)
			order by l.logged_at desc
		) as arr
		from (select * from logged order by logged_at desc limit 20) l
		left join public.profiles p on p.id = l.user_id
		left join auth.users u on u.id = l.user_id
	),
	-- una riga per sessione distinta: per le condivise quella di chi l'ha creata
	located as (
		select distinct on (l.session_key) l.*
		from logged l
		where l.latitude is not null and l.longitude is not null
		order by l.session_key, l.self_created desc, l.id
	),
	session_locations as (
		select jsonb_agg(jsonb_build_object(
			'id', l.id,
			'logged_at', to_char(l.logged_at, 'YYYY-MM-DD"T"HH24:MI:SS'),
			'date', to_char(l.date, 'YYYY-MM-DD'),
			'time', l.time,
			'user_id', l.user_id,
			'username', p.username,
			'type', l.type,
			'grams', l.grams,
			'fumo_grams', l.fumo_grams,
			'erba_grams', l.erba_grams,
			'my_fumo_grams', l.my_fumo_grams,
			'my_erba_grams', l.my_erba_grams,
			'session_grams', greatest(
				coalesce(l.my_fumo_grams, 0) + coalesce(l.my_erba_grams, 0),
				coalesce(l.fumo_grams, 0) + coalesce(l.erba_grams, 0),
				coalesce(l.grams, 0)),
			'location_name', l.location_name,
			'lat', l.latitude,
			'lng', l.longitude,
			'not_mine', l.not_mine,
			'context_tag', l.context_tag,
			'mood_rating', l.mood_rating
		) order by l.logged_at desc) as arr
		from located l
		left join public.profiles p on p.id = l.user_id
	),
	session_users as (
		select jsonb_agg(jsonb_build_object(
			'user_id', x.user_id, 'username', x.username, 'email', x.email
		) order by lower(coalesce(x.username, x.email, ''))) as arr
		from (
			select distinct l.user_id, p.username, u.email
			from located l
			left join public.profiles p on p.id = l.user_id
			left join auth.users u on u.id = l.user_id
		) x
	),
	activity as (
		select
			count(distinct user_id) filter (where self_created and created_at >= (now() at time zone 'UTC') - interval '24 hours') as dau,
			count(distinct user_id) filter (where self_created and created_at >= (now() at time zone 'UTC') - interval '30 days') as mau
		from real_smokes
	)
	select jsonb_build_object(
		'generated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		'growth', jsonb_build_object(
			'total_users', v_total_users,
			'new_users', jsonb_build_object(
				'today', (select count(*) from real_users where (created_at at time zone 'Europe/Rome')::date = v_today),
				'd7',    (select count(*) from real_users where created_at >= now() - interval '7 days'),
				'd30',   (select count(*) from real_users where created_at >= now() - interval '30 days')
			),
			'new_users_prev', jsonb_build_object(
				'd7',  (select count(*) from real_users
				        where created_at >= now() - interval '14 days'
				          and created_at <  now() - interval '7 days'),
				'd30', (select count(*) from real_users
				        where created_at >= now() - interval '60 days'
				          and created_at <  now() - interval '30 days')
			),
			'signups_by_day', coalesce((select arr from signups_by_day), '[]'::jsonb)
		),
		'usage', jsonb_build_object(
			'total_sessions', (select count(distinct session_key) from real_smokes),
			'sessions_7', (select count(distinct session_key) from real_smokes
			               where date between v_today - 6 and v_today),
			'sessions_by_day_30', coalesce((select arr from sessions_by_day), '[]'::jsonb),
			'avg_sessions_per_user', coalesce((select round(avg(n), 1) from per_user), 0),
			'dau', (select dau from activity),
			'mau', (select mau from activity),
			'dau_mau_pct', coalesce((select round(100.0 * dau / nullif(mau, 0), 1) from activity), 0)
		),
		'adoption', jsonb_build_object(
			'pct_shared_session', coalesce(round(100.0 * (select count(*) from shared_users) / nullif(v_total_users, 0), 1), 0),
			'pct_tolerance_break', coalesce(round(100.0 * (select count(*) from break_users) / nullif(v_total_users, 0), 1), 0),
			'pct_in_leaderboard', coalesce(round(100.0 * (select count(*) from leaderboard_users) / nullif(v_total_users, 0), 1), 0),
			'streak_buckets', (select jsonb_build_object(
				'zero', zero, 'd1_7', d1_7, 'd8_30', d8_30, 'd31_plus', d31_plus) from streak_buckets)
		),
		'recent_users', coalesce((select arr from recent_json), '[]'::jsonb),
		'recent_sessions', coalesce((select arr from recent_sessions), '[]'::jsonb),
		'session_locations', coalesce((select arr from session_locations), '[]'::jsonb),
		'session_users', coalesce((select arr from session_users), '[]'::jsonb)
	) into result;

	return result;
end;
$function$;

REVOKE ALL ON FUNCTION public.admin_dashboard_stats() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats() TO authenticated;
