// send-reminders/index.ts
// Gira ogni 15 minuti (schedulata via cron). Per ogni utente con reminder_enabled=true
// controlla se è il momento di avvisarlo, se non ha ancora segnato nulla oggi, e gli
// manda una notifica push (menzionando lo streak se rischia di perderlo).

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:example@example.com";
const TIMEZONE = "Europe/Rome";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function nowInTimezone(tz: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hh = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
  const mm = parseInt(parts.find((p) => p.type === "minute")!.value, 10);
  return { hh, mm };
}

function todayInTimezone(tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()); // YYYY-MM-DD
}

function floor15(hh: number, mm: number) {
  const total = hh * 60 + mm;
  return Math.floor(total / 15) * 15;
}

// Calcola lo streak "ancora vivo" considerando che oggi non ha ancora segnato:
// conta i giorni consecutivi terminanti ieri.
function computeStreakAsOfYesterday(dates: string[]): number {
  if (dates.length === 0) return 0;
  const uniqueSorted = [...new Set(dates)].sort();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().split("T")[0];

  if (uniqueSorted[uniqueSorted.length - 1] !== yStr) return 0;

  let streak = 1;
  for (let i = uniqueSorted.length - 1; i > 0; i--) {
    const a = new Date(uniqueSorted[i]);
    const b = new Date(uniqueSorted[i - 1]);
    const diff = (a.getTime() - b.getTime()) / 86400000;
    if (diff === 1) streak++;
    else break;
  }
  return streak;
}

Deno.serve(async (_req) => {
  try {
    const { hh, mm } = nowInTimezone(TIMEZONE);
    const nowSlot = floor15(hh, mm);
    const today = todayInTimezone(TIMEZONE);

    const { data: profiles, error: profErr } = await supabase
      .from("profiles")
      .select("id, username, reminder_enabled, reminder_time")
      .eq("reminder_enabled", true);

    if (profErr) throw profErr;

    let sent = 0;

    for (const profile of profiles ?? []) {
      if (!profile.reminder_time) continue;
      const [rh, rm] = profile.reminder_time.split(":").map((n: string) => parseInt(n, 10));
      if (floor15(rh, rm) !== nowSlot) continue;

      // ha già segnato oggi?
      const { data: todaySmokes } = await supabase
        .from("smokes")
        .select("id")
        .eq("user_id", profile.id)
        .eq("date", today)
        .limit(1);

      if (todaySmokes && todaySmokes.length > 0) continue; // già segnato, nessun promemoria

      // recupera date per calcolo streak
      const { data: allDates } = await supabase
        .from("smokes")
        .select("date")
        .eq("user_id", profile.id);

      const streak = computeStreakAsOfYesterday((allDates ?? []).map((d) => d.date));

      const body =
        streak >= 1
          ? `🔥 Rischi di perdere lo streak di ${streak} giorni! Non hai ancora segnato oggi.`
          : "📝 Non hai ancora segnato nulla oggi.";

      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("user_id", profile.id);

      for (const sub of subs ?? []) {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify({ title: "🌿 JointTracker", body, url: "/" })
          );
          sent++;
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // sottoscrizione scaduta/non valida: la rimuoviamo
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          } else {
            console.error("Errore invio push:", err);
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
