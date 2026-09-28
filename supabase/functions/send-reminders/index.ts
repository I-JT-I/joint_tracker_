// send-reminders/index.ts
// Gira ogni 15 minuti (schedulata via cron). Per ogni utente con reminder_enabled=true
// controlla se è il momento di avvisarlo, se non ha ancora segnato nulla oggi, e gli
// manda una notifica push (menzionando lo streak se rischia di perderlo).
// Sospeso automaticamente per gli utenti con una tolerance break attiva (is_active=true
// in tolerance_breaks): non ha senso sollecitare a fumare chi sta facendo una pausa.
// Le notifiche push di milestone/check-in della pausa non sono ancora implementate qui
// (solo in-app per ora, vedi app.js checkBreakNotifications).

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:example@example.com";
const TIMEZONE = "Europe/Rome";

// Endpoint pubblico senza JWT (chiamato dal cron interno): questo header impedisce a
// chiunque scopra l'URL di invocarlo a piacere e spammare notifiche push agli utenti.
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

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

// Giorno precedente/successivo di una data "YYYY-MM-DD", in aritmetica UTC pura.
function shiftDate(dateStr: string, deltaDays: number): string {
  return new Date(Date.parse(dateStr + "T00:00:00Z") + deltaDays * 86400000).toISOString().slice(0, 10);
}

// Streak "ancora vivo" considerando che oggi non ha ancora segnato: giorni consecutivi con
// almeno una sessione che terminano IERI (ieri calcolato dalla data di oggi a Roma, non in
// UTC). Le date si leggono in ordine decrescente a pagine e ci si ferma al primo buco:
// una select senza limite veniva troncata a max-rows (1000) righe e non era ordinata.
async function fetchStreakAsOfYesterday(userId: string, today: string): Promise<number> {
  const PAGE = 1000;
  const yesterday = shiftDate(today, -1);
  let expected = yesterday;
  let streak = 0;
  let from = 0;
  for (;;) {
    // filtro fisso (<= ieri) + offset: con un filtro che cambia a ogni pagina l'offset salterebbe righe
    const { data, error } = await supabase
      .from("smokes")
      .select("date")
      .eq("user_id", userId)
      .lte("date", yesterday)
      .order("date", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) return streak;
    for (const row of data) {
      if (row.date === expected) {
        streak++;
        expected = shiftDate(expected, -1);
      } else if (row.date < expected) {
        return streak; // buco: la serie finisce qui
      } // row.date > expected: altra sessione dello stesso giorno gia' contato
    }
    if (data.length < PAGE) return streak;
    from += data.length;
  }
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

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

      // pausa attiva: niente reminder a chi sta facendo una tolerance break
      const { data: activeBreaks } = await supabase
        .from("tolerance_breaks")
        .select("id")
        .eq("user_id", profile.id)
        .eq("is_active", true)
        .limit(1);

      if (activeBreaks && activeBreaks.length > 0) continue;

      const streak = await fetchStreakAsOfYesterday(profile.id, today);

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
            JSON.stringify({ title: "🌿 JointTracker", body, url: "/app" })
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
