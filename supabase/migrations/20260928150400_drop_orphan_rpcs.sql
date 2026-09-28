-- Pulizia dall'audit logico del 28/09/2026: RPC senza chiamanti (verificato con grep su
-- app.js, admin.html, landing ed Edge Functions).
-- * get_leaderboard(), get_social_leaderboard(): referenziano profiles.is_private, colonna
--   droppata da 20260813133256_drop_unused_is_private_column.sql -> fallivano se chiamate.
-- * get_shared_stats(uuid): sostituita da get_shared_balance nel popup amico (27/09).
-- * get_friends_snapshots(int): sostituita da get_snapshot_feed nel feed istantanee.

drop function if exists public.get_leaderboard();
drop function if exists public.get_social_leaderboard();
drop function if exists public.get_shared_stats(uuid);
drop function if exists public.get_friends_snapshots(integer);
