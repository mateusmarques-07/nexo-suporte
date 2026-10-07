// Teste da fila de correção do RT (worker → Sempre → WhatsApp), sem passar pelo WhatsApp/Vercel.
// Cria demandas direto no banco como se o Mateus tivesse mandado o atalho. SÓ empresa 6024.
// Liga a solução rt (pronta = true). No fim a 6024 volta pro RT que estava antes.
// Uso: node scripts/teste-fila-rt.mjs   (de qualquer pasta)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { RTS } from "../shared/atalhos.mjs";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const linha of fs.readFileSync(path.join(raiz, ".env.local"), "utf8").split("\n")) {
  const i = linha.indexOf("=");
  if (i > 0 && !process.env[linha.slice(0, i)]) process.env[linha.slice(0, i)] = linha.slice(i + 1);
}
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const [MICAELLI, KAROLINE] = RTS["6024"].opcoes;
const resultados = [];

async function criar({ rt, pedidoHaMin = 0, semPedido = false, rotulo }) {
  const [d] = await q(
    `insert into demandas (origem, solicitante, status, tipo, comando, params, resumo, correcao_pedida_em)
     values ('mesa', 'TESTE fila (Claude)', 'entendida', 'rt', $1, $2, $3, $4) returning id`,
    [`rt 6024 ${rt.split(" ")[0].toLowerCase()}`, { empresa: "6024", rt }, `[TESTE] ${rotulo}`,
     semPedido ? null : new Date(Date.now() - pedidoHaMin * 60_000).toISOString()]
  );
  return Number(d.id);
}

async function esperarFim(id, maxMs) {
  const ate = Date.now() + maxMs;
  let st;
  while (Date.now() < ate) {
    [st] = await q("select status from demandas where id = $1", [id]);
    if (["corrigida", "erro"].includes(st.status)) break;
    await dormir(5000);
  }
  await dormir(10_000); // o worker grava o status e só depois manda o WhatsApp

  const ev = await q("select tipo, detalhe from eventos where demanda_id = $1 order by created_at", [id]);
  const an = await q("select storage_path from anexos where demanda_id = $1", [id]);
  const msg = await q("select texto from mensagens where demanda_id = $1 and direcao = 'saida'", [id]);
  return { status: st.status, eventos: ev.map((e) => e.tipo), detalhe: ev.at(-1)?.detalhe, prints: an.length, whatsapp: msg.map((m) => m.texto) };
}

function registrar(nome, ok, info) {
  resultados.push({ nome, ok });
  console.log(`\n${ok ? "✅" : "❌"} ${nome}`);
  console.log(JSON.stringify(info, null, 1));
}

await q("update solucoes set pronta = true where chave = 'rt'");
console.log("solução rt ligada (pronta = true)");

// 1. troca
const t1 = await criar({ rt: KAROLINE, rotulo: "fila: 6024 Micaelli → Karoline" });
const r1 = await esperarFim(t1, 4 * 60_000);
registrar(`#${t1} fila troca Micaelli → Karoline`, r1.status === "corrigida" && r1.detalhe?.mudou === true && r1.prints >= 2 && r1.whatsapp.length > 0, r1);

// 2. volta
const t2 = await criar({ rt: MICAELLI, rotulo: "fila: 6024 Karoline → Micaelli (volta)" });
const r2 = await esperarFim(t2, 4 * 60_000);
registrar(`#${t2} fila volta Karoline → Micaelli`, r2.status === "corrigida" && r2.detalhe?.depois === MICAELLI, r2);

// 3. pedido velho (31 min) e 4. sem pedido (igual "Reabrir"): nenhum dos dois pode rodar
const t3 = await criar({ rt: KAROLINE, pedidoHaMin: 31, rotulo: "pedido de 31 min atrás (não pode rodar)" });
const t4 = await criar({ rt: KAROLINE, semPedido: true, rotulo: "sem pedido / reaberta (não pode rodar)" });
await dormir(40_000);
const d34 = (await q("select id, status from demandas where id = any($1)", [[t3, t4]])).map((d) => ({ ...d, id: Number(d.id) }));
for (const d of d34) registrar(`#${d.id} ${d.id === t3 ? "pedido de 31 min" : "sem pedido (Reabrir)"} não executa`, d.status === "entendida", d);
await q("update demandas set status = 'arquivada' where id = any($1)", [[t3, t4]]);

console.log(`\nRESUMO: ${resultados.filter((r) => r.ok).length}/${resultados.length} ok`);
await c.end();
