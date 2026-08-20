-- Bug: get_friend_stats only summed grams for type='fumo' or type='erba' exactly, so any
-- session logged as 'fumo-erba' (both substances in one entry) was silently dropped from the
-- totals shown in a friend's stats modal, undercounting both fumo_g and erba_g for that friend.
CREATE OR REPLACE FUNCTION public.get_friend_stats(target_user_id uuid)
 RETURNS TABLE(fumo_g numeric, erba_g numeric, totale_j bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM(COALESCE(my_fumo_grams, CASE WHEN type IN ('fumo','fumo-erba') THEN fumo_grams ELSE 0 END)), 0)::NUMERIC,
        COALESCE(SUM(COALESCE(my_erba_grams, CASE WHEN type IN ('erba','fumo-erba') THEN erba_grams ELSE 0 END)), 0)::NUMERIC,
        COUNT(id)::BIGINT
    FROM smokes
    WHERE user_id = target_user_id;
END;
$function$;
