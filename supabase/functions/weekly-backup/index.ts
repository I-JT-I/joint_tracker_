// weekly-backup/index.ts
// Esporta tutte le tabelle principali in un file JSON e lo salva nel bucket "backups".
// Gira una volta a settimana (schedulata via cron), tiene un archivio storico
// per disaster recovery indipendente dai backup manuali dell'utente.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const TABLES = ["smokes", "purchases", "places", "profiles", "friendships", "user_stats"];

Deno.serve(async (_req) => {
  try {
    const backup: Record<string, unknown> = {
      created_at: new Date().toISOString(),
    };

    for (const table of TABLES) {
      const { data, error } = await supabase.from(table).select("*");
      if (error) throw new Error(`Errore lettura ${table}: ${error.message}`);
      backup[table] = data;
    }

    const filename = `backup-${new Date().toISOString().split("T")[0]}.json`;
    const content = JSON.stringify(backup, null, 2);

    const { error: uploadErr } = await supabase.storage
      .from("backups")
      .upload(filename, new Blob([content], { type: "application/json" }), {
        upsert: true,
      });

    if (uploadErr) throw uploadErr;

    return new Response(JSON.stringify({ ok: true, filename }), {
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
