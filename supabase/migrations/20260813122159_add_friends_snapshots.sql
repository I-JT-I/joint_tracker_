-- Permette di vedere (e quindi generare signed URL per) le foto degli amici che hai aggiunto,
-- oltre alle proprie. Stessa relazione direzionale gia' usata da get_friends_leaderboard.
create policy "Friends can view shared session photos"
  on storage.objects for select
  using (
    bucket_id = 'session-photos'
    and exists (
      select 1 from public.friendships f
      where f.user_id = auth.uid()
        and f.friend_id::text = (storage.foldername(name))[1]
    )
  );

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
      or s.user_id in (select f.friend_id from public.friendships f where f.user_id = auth.uid())
    )
  order by s.ts desc
  limit limit_count;
$$;
