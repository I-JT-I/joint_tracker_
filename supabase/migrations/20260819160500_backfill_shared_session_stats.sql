-- One-time data backfill for the bug fixed in
-- 20260819160000_fix_shared_session_personal_stats.sql - run that migration
-- FIRST (so new sessions stop being written wrong), then this one to correct
-- existing rows.
--
-- What it does: for every row that's part of a shared session
-- (shared_with is a non-empty jsonb array), recomputes my_fumo_grams/
-- my_erba_grams as the sum of fumo_grams/erba_grams across ALL rows that
-- share the same session. Sessions are grouped by `ts` (the shared-session
-- timestamp is written identically to every participant's row by
-- create_shared_session - this is the same assumption the rest of the app
-- already relies on, e.g. deleteItem(ts), openPhotoViewer(ts)).
-- `type` is recomputed the same way, for consistency with the function fix.
--
-- Does NOT touch fumo_grams/erba_grams/grams (stock-deduction columns) -
-- stock history is unaffected.
--
-- Idempotent: safe to re-run, always recomputes from fumo_grams/erba_grams
-- (unaffected by this script), not from the already-corrected columns.
--
-- NOT applied automatically. Recommended: run the SELECT preview first,
-- check the numbers look right, THEN run the UPDATE.

-- ── 1) PREVIEW: what would change ───────────────────────────────────────
with session_totals as (
  select ts,
         sum(fumo_grams) as total_fumo,
         sum(erba_grams) as total_erba
  from smokes
  where shared_with is not null and jsonb_array_length(shared_with) > 0
  group by ts
)
select
  s.id, s.user_id, s.ts, s.date,
  s.my_fumo_grams as old_my_fumo, st.total_fumo as new_my_fumo,
  s.my_erba_grams as old_my_erba, st.total_erba as new_my_erba,
  s.type as old_type,
  case
    when st.total_fumo > 0 and st.total_erba > 0 then 'fumo-erba'
    when st.total_erba > 0 then 'erba'
    else 'fumo'
  end as new_type
from smokes s
join session_totals st on st.ts = s.ts
where s.shared_with is not null and jsonb_array_length(s.shared_with) > 0
  and (s.my_fumo_grams is distinct from st.total_fumo or s.my_erba_grams is distinct from st.total_erba)
order by s.ts desc;

-- ── 2) UPDATE: run only after checking the preview above looks right ───
-- with session_totals as (
--   select ts,
--          sum(fumo_grams) as total_fumo,
--          sum(erba_grams) as total_erba
--   from smokes
--   where shared_with is not null and jsonb_array_length(shared_with) > 0
--   group by ts
-- )
-- update smokes s
-- set
--   my_fumo_grams = st.total_fumo,
--   my_erba_grams = st.total_erba,
--   type = case
--     when st.total_fumo > 0 and st.total_erba > 0 then 'fumo-erba'
--     when st.total_erba > 0 then 'erba'
--     else 'fumo'
--   end
-- from session_totals st
-- where s.ts = st.ts
--   and s.shared_with is not null and jsonb_array_length(s.shared_with) > 0;
