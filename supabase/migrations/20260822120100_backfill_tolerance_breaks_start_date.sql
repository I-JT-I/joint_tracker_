-- Correzione una tantum: retrodata start_date delle pause storiche già presenti
-- all'ultima sessione registrata prima della data salvata + 1 giorno, invece della
-- data in cui l'utente/sistema se n'era accorto. Applicata in produzione via
-- Supabase MCP il 2026-08-22 (verificata: id=2 corretta da 2026-07-25 a 2026-07-17,
-- id=1 invariata perché già coincidente con l'ultima sessione reale).
update tolerance_breaks tb
set start_date = corrected.new_start
from (
  select tb2.id,
         coalesce((select max(s.date) + 1 from smokes s
                   where s.user_id = tb2.user_id and s.date < tb2.start_date),
                   tb2.start_date) as new_start
  from tolerance_breaks tb2
  where not tb2.manually_edited
) corrected
where tb.id = corrected.id and tb.start_date != corrected.new_start;
