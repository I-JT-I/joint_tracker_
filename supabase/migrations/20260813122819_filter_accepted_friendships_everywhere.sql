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
        COALESCE(SUM(s.grams), 0)::NUMERIC AS total_g,
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

create or replace function public.get_all_friends_shared_stats()
 returns table(friend_id uuid, sessions_together bigint, grams_together numeric)
 language sql
 security definer
 set search_path to 'public'
as $function$
  select f.friend_id,
         count(s.id) filter (where s.shared_with @> to_jsonb(array[f.friend_id::text])),
         coalesce(sum(s.my_fumo_grams + s.my_erba_grams) filter (where s.shared_with @> to_jsonb(array[f.friend_id::text])), 0)
  from public.friendships f
  left join public.smokes s on s.user_id = auth.uid()
  where f.user_id = auth.uid() and f.status = 'accepted'
  group by f.friend_id;
$function$;

create or replace function public.get_friends_shared_leaderboard(period text default 'month'::text)
 returns table(friend_id uuid, username text, sessions_together bigint, grams_together numeric)
 language sql
 security definer
 set search_path to 'public'
as $function$
  select f.friend_id,
         p.username,
         count(s.id) filter (
           where s.shared_with @> to_jsonb(array[f.friend_id::text])
           and (period <> 'month' or s.date >= date_trunc('month', current_date))
         ),
         coalesce(sum(s.my_fumo_grams + s.my_erba_grams) filter (
           where s.shared_with @> to_jsonb(array[f.friend_id::text])
           and (period <> 'month' or s.date >= date_trunc('month', current_date))
         ), 0)
  from public.friendships f
  join public.profiles p on p.id = f.friend_id
  left join public.smokes s on s.user_id = auth.uid()
  where f.user_id = auth.uid() and f.status = 'accepted'
  group by f.friend_id, p.username
  order by 3 desc;
$function$;

create or replace function public.get_friends_snapshots(limit_count integer default 24)
returns table(
  user_id uuid,
  username text,
  ts bigint,
  date date,
  "time" text,
  type text,
  my_fumo_grams numeric,
  my_erba_grams numeric,
  location_name text,
  photo_path text
)
language sql
security definer
set search_path to 'public'
as $$
  select s.user_id, p.username, s.ts, s.date, s.time, s.type,
         s.my_fumo_grams, s.my_erba_grams, s.location_name, s.photo_path
  from public.smokes s
  join public.profiles p on p.id = s.user_id
  where s.photo_path is not null
    and (
      s.user_id = auth.uid()
      or s.user_id in (select f.friend_id from public.friendships f where f.user_id = auth.uid() and f.status = 'accepted')
    )
  order by s.ts desc
  limit limit_count;
$$;

drop policy if exists "Friends can view shared session photos" on storage.objects;
create policy "Friends can view shared session photos"
  on storage.objects for select
  using (
    bucket_id = 'session-photos'
    and exists (
      select 1 from public.friendships f
      where f.user_id = auth.uid()
        and f.status = 'accepted'
        and f.friend_id::text = (storage.foldername(name))[1]
    )
  );
