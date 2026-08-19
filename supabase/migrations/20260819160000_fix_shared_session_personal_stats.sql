-- Fixes a bug in shared-session accounting: a participant who didn't
-- contribute anything from their own stock (not_mine = true, fumo_grams/
-- erba_grams = 0) was ALSO getting my_fumo_grams/my_erba_grams written as
-- 0, even though the client already sends a separate my_fumo_grams/
-- my_erba_grams value meant to represent "how much this session counts
-- toward this participant's personal stats" (independent of their stock
-- contribution).
--
-- create_shared_session() was ignoring those two client-sent fields and
-- reusing the stock-contribution amount for both purposes. This is why a
-- friend added to 3 shared sessions of 0.3g each, without contributing to
-- their own stock, ended up with only 0.3g (not 0.9g) in their personal
-- stats and on the leaderboards.
--
-- get_global_leaderboard() and get_friends_leaderboard() had a related but
-- separate bug: they summed the stock column (s.grams) instead of
-- my_fumo_grams/my_erba_grams like get_friend_stats() already does
-- correctly.
--
-- None of this touches fumo_grams/erba_grams/grams (the stock-deduction
-- columns) - stock behavior is unchanged.
--
-- NOT applied automatically - review and run yourself in the Supabase SQL
-- editor. This only fixes NEW shared sessions going forward; existing rows
-- already written with the bug are not corrected by this migration (see
-- the chat for an optional backfill script if you want historical data
-- fixed too).

CREATE OR REPLACE FUNCTION public.create_shared_session(
  p_date date,
  p_time text,
  p_ts bigint,
  p_latitude numeric,
  p_longitude numeric,
  p_location_name text,
  p_participants jsonb,
  p_context_tag text DEFAULT NULL::text,
  p_mood_rating smallint DEFAULT NULL::smallint,
  p_photo_path text DEFAULT NULL::text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  participant jsonb;
  all_ids jsonb;
  caller_username text;
  p_fumo numeric;
  p_erba numeric;
  p_my_fumo numeric;
  p_my_erba numeric;
begin
  if not exists (
    select 1 from jsonb_array_elements(p_participants) p
    where (p->>'user_id')::uuid = auth.uid()
  ) then
    raise exception 'Devi essere uno dei partecipanti della sessione';
  end if;

  select username into caller_username from public.profiles where id = auth.uid();

  select jsonb_agg(p->>'user_id') into all_ids from jsonb_array_elements(p_participants) p;

  for participant in select * from jsonb_array_elements(p_participants)
  loop
    p_fumo := coalesce((participant->>'fumo_grams')::numeric, 0);
    p_erba := coalesce((participant->>'erba_grams')::numeric, 0);

    -- Quanto conta per le statistiche PERSONALI di questo partecipante: puo'
    -- differire dalla sua quota di scorta (p_fumo/p_erba) - es. chi non
    -- contribuisce alla scorta ma ha comunque fumato l'intera sessione con
    -- gli altri. Il client invia gia' questo valore separatamente; prima
    -- veniva ignorato e si riusava p_fumo/p_erba anche qui.
    p_my_fumo := coalesce((participant->>'my_fumo_grams')::numeric, p_fumo);
    p_my_erba := coalesce((participant->>'my_erba_grams')::numeric, p_erba);

    insert into public.smokes (
      user_id, type, grams, fumo_grams, erba_grams,
      my_fumo_grams, my_erba_grams, date, time, ts,
      latitude, longitude, location_name, not_mine, shared_with,
      context_tag, mood_rating, photo_path
    ) values (
      (participant->>'user_id')::uuid,
      -- 'type' riflette cosa ha fumato QUESTO partecipante (my_fumo/my_erba),
      -- non solo quanto ha contribuito alla scorta - altrimenti chi non
      -- contribuisce risulterebbe sempre 'fumo' di default.
      case
        when p_my_fumo > 0 and p_my_erba > 0 then 'fumo-erba'
        when p_my_erba > 0 then 'erba'
        else 'fumo'
      end,
      p_fumo + p_erba,
      p_fumo,
      p_erba,
      p_my_fumo,
      p_my_erba,
      p_date, p_time, p_ts,
      p_latitude, p_longitude, p_location_name,
      (participant->>'not_mine')::boolean,
      all_ids - (participant->>'user_id'),
      case when (participant->>'user_id')::uuid = auth.uid() then p_context_tag else null end,
      case when (participant->>'user_id')::uuid = auth.uid() then p_mood_rating else null end,
      case when (participant->>'user_id')::uuid = auth.uid() then p_photo_path else null end
    );

    if (participant->>'user_id')::uuid <> auth.uid() then
      insert into public.notifications (user_id, type, message)
      values (
        (participant->>'user_id')::uuid,
        'shared_session',
        coalesce(caller_username, 'Un amico') || ' ti ha aggiunto a una sessione condivisa 🌿'
      );
    end if;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_global_leaderboard()
 RETURNS TABLE(user_id uuid, username text, total_g numeric, total_j bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.username,
        COALESCE(SUM(
            COALESCE(s.my_fumo_grams, CASE WHEN s.type IN ('fumo','fumo-erba') THEN s.fumo_grams ELSE 0 END) +
            COALESCE(s.my_erba_grams, CASE WHEN s.type IN ('erba','fumo-erba') THEN s.erba_grams ELSE 0 END)
        ), 0)::NUMERIC,
        COUNT(s.id)::BIGINT
    FROM profiles p
    LEFT JOIN smokes s ON s.user_id = p.id
    GROUP BY p.id, p.username
    ORDER BY 3 DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_friends_leaderboard(current_user_id uuid)
 RETURNS TABLE(user_id uuid, username text, total_g numeric, total_j bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        p.id AS user_id,
        p.username,
        COALESCE(SUM(
            COALESCE(s.my_fumo_grams, CASE WHEN s.type IN ('fumo','fumo-erba') THEN s.fumo_grams ELSE 0 END) +
            COALESCE(s.my_erba_grams, CASE WHEN s.type IN ('erba','fumo-erba') THEN s.erba_grams ELSE 0 END)
        ), 0)::NUMERIC AS total_g,
        COUNT(s.id)::BIGINT AS total_j
    FROM profiles p
    LEFT JOIN smokes s ON s.user_id = p.id
    WHERE
        p.id = current_user_id
        OR
        p.id IN (
            SELECT f.friend_id
            FROM friendships f
            WHERE f.user_id = current_user_id AND f.status = 'accepted'
        )
    GROUP BY p.id, p.username
    ORDER BY total_g DESC;
END;
$function$;
