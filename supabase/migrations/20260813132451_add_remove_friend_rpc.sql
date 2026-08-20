-- Rimuove l'amicizia in entrambe le direzioni (l'accettazione ne aveva create due,
-- una per parte, per la visibilita' reciproca): senza questo, cancellando solo la
-- propria riga l'altra persona continuerebbe a vedere i tuoi dati.
create or replace function public.remove_friend(target_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.friendships
  where (user_id = auth.uid() and friend_id = target_id)
     or (user_id = target_id and friend_id = auth.uid());
$$;
