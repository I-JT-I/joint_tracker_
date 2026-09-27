-- Backfill delle amicizie storiche unidirezionali.
--
-- Il flusso attuale (respond_friend_request) scrive DUE righe 'accepted', una per
-- direzione. Le amicizie create prima di quel flusso avevano una sola riga
-- (A -> B): B non vedeva A nel tab Amici, nella classifica amici ne' nel feed
-- istantanee, perche' quelle RPC guardano solo friendships.user_id = auth.uid().
-- Al 2026-09-27 in produzione erano 8 su 10 righe 'accepted'.
--
-- Qui si crea la riga inversa (B -> A, 'accepted') per ognuna, cosi' ogni
-- amicizia accettata e' simmetrica come quelle nuove. Effetto visibile: B ora
-- vede A tra gli amici, le sue statistiche e le sue istantanee (A aveva gia'
-- accesso a quelle di B). Nessuna notifica viene inviata.
--
-- Idempotente: rilanciarla non crea duplicati (UNIQUE user_id, friend_id).

insert into public.friendships (user_id, friend_id, status)
select f.friend_id, f.user_id, 'accepted'
from public.friendships f
where f.status = 'accepted'
	and f.user_id is not null
	and f.friend_id is not null
	and f.user_id <> f.friend_id
	and not exists (
		select 1 from public.friendships r
		where r.user_id = f.friend_id and r.friend_id = f.user_id
	)
on conflict (user_id, friend_id) do nothing;
