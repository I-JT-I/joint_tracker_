// list-backups/index.ts
// Restituisce solo i METADATI (nome file + data) dei backup settimanali generati da
// weekly-backup, mai il contenuto: il bucket "backups" contiene un dump di TUTTE le tabelle
// per TUTTI gli utenti, quindi non va mai reso scaricabile o leggibile lato client/utente
// normale (nessuna policy storage.objects e' stata aggiunta apposta). Richiede un utente
// autenticato (verify_jwt=true) solo per evitare chiamate anonime dall'esterno.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (_req) => {
  try {
    const { data, error } = await supabase.storage
      .from("backups")
      .list("", { limit: 20, sortBy: { column: "created_at", order: "desc" } });

    if (error) throw error;

    const files = (data ?? [])
      .filter((f) => f.name.endsWith(".json"))
      .map((f) => ({ name: f.name, created_at: f.created_at }));

    return new Response(JSON.stringify({ ok: true, files }), {
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
