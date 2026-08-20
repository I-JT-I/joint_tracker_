create or replace function public.send_friend_request(target_username text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  target_id uuid;
  requester_username text;
begin
  select id into target_id from public.profiles where username ilike target_username;
  if target_id is null then
    raise exception 'Utente non trovato';
  end if;
  if target_id = auth.uid() then
    raise exception 'Non puoi aggiungere te stesso';
  end if;

  if exists (
    select 1 from public.friendships
    where user_id = auth.uid() and friend_id = target_id
  ) then
    raise exception 'Richiesta gia inviata o siete gia amici';
  end if;

  insert into public.friendships (user_id, friend_id, status)
  values (auth.uid(), target_id, 'pending');

  select username into requester_username from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, type, message)
  values (
    target_id,
    'friend_request',
    coalesce(requester_username, 'Qualcuno') || ' ti ha inviato una richiesta di amicizia 👥'
  );
end;
$$;

create or replace function public.respond_friend_request(requester_id uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  responder_username text;
begin
  if not exists (
    select 1 from public.friendships
    where user_id = requester_id and friend_id = auth.uid() and status = 'pending'
  ) then
    raise exception 'Nessuna richiesta in sospeso da questo utente';
  end if;

  if accept then
    update public.friendships
    set status = 'accepted'
    where user_id = requester_id and friend_id = auth.uid();

    insert into public.friendships (user_id, friend_id, status)
    values (auth.uid(), requester_id, 'accepted')
    on conflict (user_id, friend_id) do update set status = 'accepted';

    select username into responder_username from public.profiles where id = auth.uid();

    insert into public.notifications (user_id, type, message)
    values (
      requester_id,
      'friend_accepted',
      coalesce(responder_username, 'Qualcuno') || ' ha accettato la tua richiesta di amicizia 🤝'
    );
  else
    delete from public.friendships
    where user_id = requester_id and friend_id = auth.uid() and status = 'pending';
  end if;
end;
$$;

create or replace function public.get_pending_friend_requests()
returns table(requester_id uuid, username text)
language sql
security definer
set search_path to 'public'
as $$
  select f.user_id, p.username
  from public.friendships f
  join public.profiles p on p.id = f.user_id
  where f.friend_id = auth.uid() and f.status = 'pending'
  order by f.id desc;
$$;
