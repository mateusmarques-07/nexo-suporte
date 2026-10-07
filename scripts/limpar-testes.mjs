// Zera demandas/mensagens/eventos/anexos de TESTE (tabelas + arquivos do bucket "anexos").
// Só usar antes de entrar em uso real.
// Uso: node scripts/limpar-testes.mjs --sim
import fs from "node:fs";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

if (process.argv[2] !== "--sim") {
  console.error("Isto apaga TODAS as demandas. Rode com --sim pra confirmar.");
  process.exit(1);
}
for (const linha of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = linha.indexOf("=");
  if (i > 0 && !process.env[linha.slice(0, i)]) process.env[linha.slice(0, i)] = linha.slice(i + 1);
}
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const caminhos = (await c.query("select storage_path from anexos")).rows.map((r) => r.storage_path);
if (caminhos.length) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await sb.storage.from("anexos").remove(caminhos);
  if (error) throw error;
  console.log(`${caminhos.length} arquivo(s) apagado(s) do bucket`);
}

await c.query("truncate anexos, mensagens, eventos, demandas restart identity cascade");
console.log("testes apagados; próxima demanda volta a ser #1");
await c.end();
