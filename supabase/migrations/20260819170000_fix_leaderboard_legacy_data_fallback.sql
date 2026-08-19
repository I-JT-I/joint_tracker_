-- Fixes a regression introduced by 20260819160000: get_global_leaderboard()
-- and get_friends_leaderboard() were changed to sum my_fumo_grams/
-- my_erba_grams (falling back to fumo_grams/erba_grams by type) instead of
-- the old SUM(grams). That broke totals for any user with rows created
-- before the fumo_grams/erba_grams/my_fumo_grams/my_erba_grams columns
-- existed - those legacy rows only ever had `grams` populated, and the new
-- formula ignored it entirely, silently reading them as 0.
--
-- Confirmed on real data: a user with 479 historical rows dropped from
-- 180g to 46g on the leaderboard after applying 20260819160000. Their
-- fumo_grams/erba_grams/my_fumo_grams/my_erba_grams are all 0/NULL; only
-- `grams` holds the real amount for those rows.
--
-- Fix: use GREATEST across three ways of reading "how much this row counts"
-- (my_fumo/erba_grams, fumo/erba_grams, grams) so whichever column is
-- actually populated - old schema or new - is used. For normal rows all
-- three already agree, so this changes nothing; for shared-session rows it
-- keeps the fix from 20260819160000 (participant credited in full even if
-- their stock contribution was 0); for legacy rows it now falls back to
-- `grams` instead of reading 0.
--
-- get_friend_stats() had the same latent weakness (never triggered before
-- because it wasn't exercised against this user's data) - fixed here too,
-- with the `grams` fallback restricted to single-substance rows (type =
-- 'fumo' or 'erba' exactly) to avoid double-counting on the rare legacy
-- 'fumo-erba' row where the fumo/erba split can't be recovered from
-- `grams` alone.
--
-- NOT applied automatically - review and run yourself in the Supabase SQL
-- editor. Supersedes the leaderboard functions from 20260819160000 (same
-- function names, CREATE OR REPLACE) - re-running that older migration
-- after this one would reintroduce the bug, so always apply in date order.

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
            GREATEST(
                COALESCE(s.my_fumo_grams, 0) + COALESCE(s.my_erba_grams, 0),
                COALESCE(s.fumo_grams, 0) + COALESCE(s.erba_grams, 0),
                COALESCE(s.grams, 0)
            )
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
            GREATEST(
                COALESCE(s.my_fumo_grams, 0) + COALESCE(s.my_erba_grams, 0),
                COALESCE(s.fumo_grams, 0) + COALESCE(s.erba_grams, 0),
                COALESCE(s.grams, 0)
            )
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

CREATE OR REPLACE FUNCTION public.get_friend_stats(target_user_id uuid)
 RETURNS TABLE(fumo_g numeric, erba_g numeric, totale_j bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM(GREATEST(
            COALESCE(my_fumo_grams, 0),
            COALESCE(fumo_grams, 0),
            CASE WHEN type = 'fumo' THEN COALESCE(grams, 0) ELSE 0 END
        )), 0)::NUMERIC,
        COALESCE(SUM(GREATEST(
            COALESCE(my_erba_grams, 0),
            COALESCE(erba_grams, 0),
            CASE WHEN type = 'erba' THEN COALESCE(grams, 0) ELSE 0 END
        )), 0)::NUMERIC,
        COUNT(id)::BIGINT
    FROM smokes
    WHERE user_id = target_user_id;
END;
$function$;
