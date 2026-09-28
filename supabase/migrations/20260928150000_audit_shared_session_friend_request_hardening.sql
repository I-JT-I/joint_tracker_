-- Fix dall'audit logico del 28/09/2026 (AUDIT_REPORT.md: F-03, F-16, F-21, F-25).
--
-- 1) smokes.created_by: chi ha INSERITO la riga (default auth.uid()). Per le sessioni
--    condivise create_shared_session scrive anche le righe degli altri partecipanti:
--    created_by = chi l'ha creata, user_id = il partecipante. Serve alla dashboard admin
--    per non contare come "attivo" chi e' stato solo aggiunto da un amico (DAU/MAU).
--    Righe storiche: NULL (= inserite dal proprietario stesso).
--
-- 2) notifications.msg_key / msg_params: la notifica viene salvata anche come chiave i18n +
--    parametri e tradotta dal client nella lingua attiva. "message" resta valorizzato come
--    fallback per client vecchi, quindi la migration e' retrocompatibile.
--
-- 3) create_shared_session: ogni partecipante diverso da chi chiama deve essere un amico
--    ACCETTATO (prima chiunque poteva scrivere sessioni con grammi arbitrari nello storico di
--    qualsiasi username) + validazione di grammi e numero partecipanti.
--
-- 4) send_friend_request: match esatto dello username (prima ILIKE sull'input grezzo:
--    "%" o "_" facevano da jolly e la richiesta partiva verso un utente qualsiasi).
--
-- SECURITY DEFINER invariato (vedi CLAUDE.md per le motivazioni).

-- ---------- 1) created_by ----------
alter table public.smokes add column if not exists created_by uuid;
-- default separato dall'ADD COLUMN: le righe esistenti restano NULL (nessun rewrite con auth.uid()).
alter table public.smokes alter column created_by set default auth.uid();

-- ---------- 2) notifiche traducibili ----------
alter table public.notifications add column if not exists msg_key text;
alter table public.notifications add column if not exists msg_params jsonb;

-- ---------- 3) create_shared_session ----------
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
  v_me uuid := auth.uid();
  participant jsonb;
  all_ids jsonb;
  caller_username text;
  v_pid uuid;
  p_fumo numeric;
  p_erba numeric;
  p_my_fumo numeric;
  p_my_erba numeric;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_participants) <> 'array' or jsonb_array_length(p_participants) < 2 or jsonb_array_length(p_participants) > 20 then
    raise exception 'Partecipanti non validi' using errcode = '22023';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_participants) p
    where (p->>'user_id')::uuid = v_me
  ) then
    raise exception 'Devi essere uno dei partecipanti della sessione';
  end if;
  if (select count(distinct p->>'user_id') from jsonb_array_elements(p_participants) p) <> jsonb_array_length(p_participants) then
    raise exception 'Partecipanti duplicati' using errcode = '22023';
  end if;

  -- Solo amici accettati: senza questo controllo chiunque poteva inserire sessioni nello
  -- storico di qualsiasi utente (streak, statistiche, traguardi, classifiche, pause).
  for participant in select * from jsonb_array_elements(p_participants)
  loop
    v_pid := (participant->>'user_id')::uuid;
    if v_pid <> v_me and not public.are_accepted_friends(v_me, v_pid) then
      raise exception 'Puoi condividere una sessione solo con i tuoi amici' using errcode = '42501';
    end if;
    -- grammi: numerici, non negativi e con un tetto di sicurezza per sessione
    if coalesce((participant->>'fumo_grams')::numeric, 0) not between 0 and 100
      or coalesce((participant->>'erba_grams')::numeric, 0) not between 0 and 100
      or coalesce((participant->>'my_fumo_grams')::numeric, 0) not between 0 and 100
      or coalesce((participant->>'my_erba_grams')::numeric, 0) not between 0 and 100 then
      raise exception 'Quantita non valida' using errcode = '22023';
    end if;
  end loop;

  select username into caller_username from public.profiles where id = v_me;

  select jsonb_agg(p->>'user_id') into all_ids from jsonb_array_elements(p_participants) p;

  for participant in select * from jsonb_array_elements(p_participants)
  loop
    p_fumo := coalesce((participant->>'fumo_grams')::numeric, 0);
    p_erba := coalesce((participant->>'erba_grams')::numeric, 0);

    -- my_*: quanto conta la sessione per le statistiche personali del partecipante
    -- (il client invia il totale dell'intera sessione, uguale per tutti: vedi CLAUDE.md).
    p_my_fumo := coalesce((participant->>'my_fumo_grams')::numeric, p_fumo);
    p_my_erba := coalesce((participant->>'my_erba_grams')::numeric, p_erba);

    insert into public.smokes (
      user_id, type, grams, fumo_grams, erba_grams,
      my_fumo_grams, my_erba_grams, date, time, ts,
      latitude, longitude, location_name, not_mine, shared_with,
      context_tag, mood_rating, photo_path, created_by
    ) values (
      (participant->>'user_id')::uuid,
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
      coalesce((participant->>'not_mine')::boolean, false),
      all_ids - (participant->>'user_id'),
      case when (participant->>'user_id')::uuid = v_me then p_context_tag else null end,
      case when (participant->>'user_id')::uuid = v_me then p_mood_rating else null end,
      case when (participant->>'user_id')::uuid = v_me then p_photo_path else null end,
      v_me
    );

    if (participant->>'user_id')::uuid <> v_me then
      insert into public.notifications (user_id, type, message, msg_key, msg_params)
      values (
        (participant->>'user_id')::uuid,
        'shared_session',
        coalesce(caller_username, 'Un amico') || ' ti ha aggiunto a una sessione condivisa 🌿',
        'notif.sharedSessionAdded',
        jsonb_build_object('username', coalesce(caller_username, '?'))
      );
    end if;
  end loop;
end;
$function$;

-- ---------- 4) send_friend_request ----------
CREATE OR REPLACE FUNCTION public.send_friend_request(target_username text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_id uuid;
  n_ci int;
  requester_username text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Match esatto; in mancanza, case-insensitive ma solo se univoco. Niente ILIKE: con
  -- l'input grezzo "%" e "_" erano jolly e SELECT INTO prendeva un profilo qualsiasi.
  select id into target_id from public.profiles where username = target_username;
  if target_id is null then
    select count(*) into n_ci from public.profiles where lower(username) = lower(target_username);
    if n_ci = 1 then
      select id into target_id from public.profiles where lower(username) = lower(target_username);
    end if;
  end if;
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

  insert into public.notifications (user_id, type, message, msg_key, msg_params)
  values (
    target_id,
    'friend_request',
    coalesce(requester_username, 'Qualcuno') || ' ti ha inviato una richiesta di amicizia 👥',
    'notif.friendRequest',
    jsonb_build_object('username', coalesce(requester_username, '?'))
  );
end;
$function$;

-- ---------- respond_friend_request: solo notifica traducibile ----------
CREATE OR REPLACE FUNCTION public.respond_friend_request(requester_id uuid, accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    insert into public.notifications (user_id, type, message, msg_key, msg_params)
    values (
      requester_id,
      'friend_accepted',
      coalesce(responder_username, 'Qualcuno') || ' ha accettato la tua richiesta di amicizia 🤝',
      'notif.friendAccepted',
      jsonb_build_object('username', coalesce(responder_username, '?'))
    );
  else
    delete from public.friendships
    where user_id = requester_id and friend_id = auth.uid() and status = 'pending';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.create_shared_session(date, text, bigint, numeric, numeric, text, jsonb, text, smallint, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_shared_session(date, text, bigint, numeric, numeric, text, jsonb, text, smallint, text) TO authenticated;
REVOKE ALL ON FUNCTION public.send_friend_request(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.send_friend_request(text) TO authenticated;
REVOKE ALL ON FUNCTION public.respond_friend_request(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.respond_friend_request(uuid, boolean) TO authenticated;
