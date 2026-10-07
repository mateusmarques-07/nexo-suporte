// Aplica os arquivos sql/*.sql em ordem no banco do Supabase (SUPABASE_DB_URL do .env.local).
// Uso: node scripts/migrar.mjs            (aplica todos)
//      node scripts/migrar.mjs 001        (só os que começam com 001)
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

for (const linha of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = linha.indexOf("=");
  if (i > 0 && !process.env[linha.slice(0, i)]) process.env[linha.slice(0, i)] = linha.slice(i + 1);
}

const filtro = process.argv[2] ?? "";
const arquivos = fs.readdirSync("sql").filter((f) => f.endsWith(".sql") && f.startsWith(filtro)).sort();
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
for (const f of arquivos) {
  process.stdout.write(`aplicando ${f}... `);
  await client.query(fs.readFileSync(path.join("sql", f), "utf8"));
  console.log("ok");
}
const { rows } = await client.query(
  "select table_name from information_schema.tables where table_schema='public' order by 1"
);
console.log("tabelas:", rows.map((r) => r.table_name).join(", "));
await client.end();
