-- Le righe esistenti erano gia' "amicizie" instaurate senza consenso sotto il vecchio
-- modello: le manteniamo attive (accepted) per non rompere nulla a chi le usa gia'.
-- Da qui in avanti, le nuove aggiunte partono come richieste (pending) da accettare.
alter table public.friendships add column status text not null default 'accepted';
alter table public.friendships add constraint friendships_status_check check (status in ('pending', 'accepted'));
alter table public.friendships alter column status set default 'pending';

-- Permette al destinatario di vedere le richieste in arrivo (prima poteva vedere solo
-- le righe dove lui stesso e' user_id, cioe' le amicizie/richieste che ha inviato lui).
create policy "Ricevi richieste di amicizia"
  on public.friendships for select
  using (auth.uid() = friend_id);
