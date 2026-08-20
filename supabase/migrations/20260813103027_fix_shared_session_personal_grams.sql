-- Bug: my_fumo_grams/my_erba_grams (and therefore type + grams) were being set to the
-- SESSION CREATOR's own personal amount for EVERY participant, instead of each participant's
-- own amount. This corrupted personal stats/streak/achievements/charts/leaderboards for anyone
-- added to a shared session by someone else. Fix: use each participant's own contributed
-- fumo_grams/erba_grams (already correctly individualized) as their personal amount too.
CREATE OR REPLACE FUNCTION public.create_shared_session(p_date date, p_time text, p_ts bigint, p_latitude numeric, p_longitude numeric, p_location_name text, p_participants jsonb)
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

    insert into public.smokes (
      user_id, type, grams, fumo_grams, erba_grams,
      my_fumo_grams, my_erba_grams, date, time, ts,
      latitude, longitude, location_name, not_mine, shared_with
    ) values (
      (participant->>'user_id')::uuid,
      case
        when p_fumo > 0 and p_erba > 0 then 'fumo-erba'
        when p_erba > 0 then 'erba'
        else 'fumo'
      end,
      p_fumo + p_erba,
      p_fumo,
      p_erba,
      p_fumo,
      p_erba,
      p_date, p_time, p_ts,
      p_latitude, p_longitude, p_location_name,
      (participant->>'not_mine')::boolean,
      all_ids - (participant->>'user_id')
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
