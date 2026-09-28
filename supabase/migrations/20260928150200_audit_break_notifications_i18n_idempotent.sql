-- Fix dall'audit logico del 28/09/2026 (AUDIT_REPORT.md: F-11, F-25).
--
-- insert_own_notification(p_type, p_message, p_key, p_params): nuova versione a 4
-- argomenti usata dal client per milestone, check-in e suggerimenti della tolerance break.
-- Salva anche chiave i18n + parametri (tradotti dal client nella lingua attiva: prima il
-- testo restava nella lingua del momento dell'inserimento). Resta SECURITY DEFINER per lo
-- stesso motivo della versione a 2 argomenti (notifications non ha una policy INSERT) e
-- scrive sempre e solo con user_id = auth.uid(). Tipi ammessi limitati a quelli della pausa.
--
-- Idempotenza: indice unico parziale su (utente, tipo, chiave, parametri) per le notifiche
-- della pausa con chiave. I parametri includono break_id (e il giorno per i check-in),
-- quindi la stessa milestone della stessa pausa non puo' essere inserita due volte anche
-- con due loadBreaks() concorrenti: prima nel DB c'erano 5 righe duplicate ("Giorno 2" x3).
-- Le righe storiche (msg_key NULL) sono fuori dall'indice.
--
-- La versione a 2 argomenti resta per i client non aggiornati, ma non e' piu' eseguibile da
-- anon (senza auth.uid() l'insert falliva comunque sul NOT NULL di user_id).

create unique index if not exists notifications_break_once
	on public.notifications (user_id, type, msg_key, msg_params)
	where msg_key is not null and type = 'tolerance_break_milestone';

CREATE OR REPLACE FUNCTION public.insert_own_notification(p_type text, p_message text, p_key text, p_params jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
	if auth.uid() is null then
		raise exception 'not authenticated' using errcode = '42501';
	end if;
	if p_type not in ('tolerance_break_milestone', 'break_suggestion') then
		raise exception 'invalid notification type' using errcode = '22023';
	end if;
	if p_key is not null and p_key !~ '^[A-Za-z0-9_.]{1,80}$' then
		raise exception 'invalid key' using errcode = '22023';
	end if;

	insert into public.notifications (user_id, type, message, msg_key, msg_params)
	values (auth.uid(), p_type, left(p_message, 1000), p_key, coalesce(p_params, '{}'::jsonb))
	on conflict do nothing;
end;
$function$;

REVOKE ALL ON FUNCTION public.insert_own_notification(text, text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.insert_own_notification(text, text, text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.insert_own_notification(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.insert_own_notification(text, text) TO authenticated;
