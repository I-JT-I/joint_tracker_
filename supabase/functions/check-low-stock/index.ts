// check-low-stock/index.ts
// Gira una volta al giorno (schedulata via cron). Per ogni utente con scorte aperte,
// replica la stessa logica FIFO usata dal client (gramsRemainingForPurchase) per stimare
// i giorni rimanenti in base al consumo medio degli ultimi 14gg, e manda una notifica push
// + in-app quando restano <= 2 giorni. Non rimanda lo stesso avviso piu' spesso di ogni 3
// giorni per tipo, per non spammare.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:example@example.com";

const DAYS_WINDOW = 14;
const LOW_STOCK_DAYS_THRESHOLD = 2;
const RENOTIFY_AFTER_DAYS = 3;

// Endpoint pubblico senza JWT (chiamato dal cron interno): questo header impedisce a
// chiunque scopra l'URL di invocarlo a piacere e spammare notifiche push agli utenti.
const CRON_SECRET = "73883e010b636dd2f246502a0908aaf26ae4d353e05762700f48cfc2ee91712b";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

type Purchase = { id: number; date: string; grams: number | string };
type Smoke = { date: string; fumo_grams: number | null; erba_grams: number | null; not_mine: boolean | null };

// Stesso algoritmo FIFO del client: consumo cumulato dal primo acquisto aperto,
// scalato in ordine dal piu' vecchio all'ultimo.
function computeRemaining(openPurchases: Purchase[], allSmokes: Smoke[], type: "fumo" | "erba") {
  if (openPurchases.length === 0) return 0;
  const sorted = [...openPurchases].sort((a, b) => a.date.localeCompare(b.date));
  const oldestDate = sorted[0].date;

  const totalConsumed = allSmokes
    .filter((s) => !s.not_mine && s.date >= oldestDate)
    .reduce((sum, s) => sum + (type === "fumo" ? (s.fumo_grams || 0) : (s.erba_grams || 0)), 0);

  let remainingTotal = 0;
  let consumedRemaining = totalConsumed;
  for (const p of sorted) {
    const grams = parseFloat(String(p.grams));
    const consumedHere = Math.min(consumedRemaining, grams);
    remainingTotal += Math.max(0, grams - consumedHere);
    consumedRemaining = Math.max(0, consumedRemaining - grams);
  }
  return remainingTotal;
}

function computeDailyRate(allSmokes: Smoke[], type: "fumo" | "erba") {
  const cutoff = daysAgoStr(DAYS_WINDOW);
  const grams = allSmokes
    .filter((s) => !s.not_mine && s.date >= cutoff)
    .reduce((sum, s) => sum + (type === "fumo" ? (s.fumo_grams || 0) : (s.erba_grams || 0)), 0);
  return grams / DAYS_WINDOW;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { data: profiles, error: profErr } = await supabase.from("profiles").select("id, username");
    if (profErr) throw profErr;

    let sent = 0;

    for (const profile of profiles ?? []) {
      const { data: purchases } = await supabase
        .from("purchases")
        .select("id, type, date, grams")
        .eq("user_id", profile.id)
        .eq("is_closed", false);

      if (!purchases || purchases.length === 0) continue;

      const { data: smokes } = await supabase
        .from("smokes")
        .select("date, fumo_grams, erba_grams, not_mine")
        .eq("user_id", profile.id);

      for (const type of ["fumo", "erba"] as const) {
        const openForType = purchases.filter((p) => p.type === type);
        if (openForType.length === 0) continue;

        const remaining = computeRemaining(openForType, smokes ?? [], type);
        if (remaining <= 0) continue;

        const dailyRate = computeDailyRate(smokes ?? [], type);
        if (dailyRate <= 0) continue;

        const daysLeft = remaining / dailyRate;
        if (daysLeft > LOW_STOCK_DAYS_THRESHOLD) continue;

        const notifType = `low_stock_${type}`;
        const { data: recentNotif } = await supabase
          .from("notifications")
          .select("id")
          .eq("user_id", profile.id)
          .eq("type", notifType)
          .gte("created_at", new Date(Date.now() - RENOTIFY_AFTER_DAYS * 86400000).toISOString())
          .limit(1);

        if (recentNotif && recentNotif.length > 0) continue;

        const emoji = type === "fumo" ? "🍫" : "🍃";
        const roundedDays = Math.round(daysLeft);
        const message = `${emoji} Scorta di ${type} in esaurimento: circa ${roundedDays} giorn${roundedDays === 1 ? "o" : "i"} rimasti (${remaining.toFixed(1)}g).`;

        await supabase.from("notifications").insert({
          user_id: profile.id,
          type: notifType,
          message,
        });

        const { data: subs } = await supabase
          .from("push_subscriptions")
          .select("id, endpoint, p256dh, auth")
          .eq("user_id", profile.id);

        for (const sub of subs ?? []) {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              JSON.stringify({ title: "🌿 JointTracker", body: message, url: "/" })
            );
            sent++;
          } catch (err: unknown) {
            const statusCode = (err as { statusCode?: number })?.statusCode;
            if (statusCode === 404 || statusCode === 410) {
              await supabase.from("push_subscriptions").delete().eq("id", sub.id);
            } else {
              console.error("Errore invio push scorte:", err);
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
