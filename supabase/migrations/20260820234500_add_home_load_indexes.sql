-- Indici mancanti su user_id (+ colonna di order) per le query della home,
-- che finora filtravano/ordinavano queste tabelle senza copertura da indice
-- (confermato dal performance advisor di Supabase: unindexed_foreign_keys).
create index if not exists purchases_user_id_date_idx
    on public.purchases (user_id, date desc);

create index if not exists notifications_user_id_created_at_idx
    on public.notifications (user_id, created_at desc);

create index if not exists tolerance_breaks_user_id_start_date_idx
    on public.tolerance_breaks (user_id, start_date desc);
