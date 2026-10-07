// Cria (ou redefine a senha de) um usuário da mesa.
// Uso: node scripts/criar-usuario.mjs email@exemplo.com [senha]
// Sem senha, gera uma aleatória e mostra uma vez.
import fs from "node:fs";
import crypto from "node:crypto";

for (const linha of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = linha.indexOf("=");
  if (i > 0 && !process.env[linha.slice(0, i)]) process.env[linha.slice(0, i)] = linha.slice(i + 1);
}
const [email, senhaArg] = process.argv.slice(2);
if (!email) {
  console.error("Uso: node scripts/criar-usuario.mjs email [senha]");
  process.exit(1);
}
const senha = senhaArg ?? `Nexo-${crypto.randomBytes(4).toString("hex")}`;
// fetch direto na API de auth (o supabase-js exige WebSocket, que o Node 20 não tem sem flag)
const URL_AUTH = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users`;
const H = { apikey: process.env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`, "Content-Type": "application/json" };
const lista = await (await fetch(`${URL_AUTH}?per_page=200`, { headers: H })).json();
const existente = (lista.users ?? []).find((u) => u.email === email.toLowerCase());
const r = existente
  ? await fetch(`${URL_AUTH}/${existente.id}`, { method: "PUT", headers: H, body: JSON.stringify({ password: senha }) })
  : await fetch(URL_AUTH, { method: "POST", headers: H, body: JSON.stringify({ email, password: senha, email_confirm: true }) });
if (!r.ok) {
  console.error("erro:", r.status, await r.text());
  process.exit(1);
}
console.log(existente ? "senha redefinida" : "usuário criado", email, "senha:", senha);
