// Teste da IA dentro do worker: cria demandas no banco como se tivessem chegado pelo WhatsApp
// e confere a sugestão + a mensagem que o worker mandou. Não mexe no Sempre.
// No fim arquiva tudo e limpa as sugestões (um "sim" depois não confirma nada de teste).
// Uso: node scripts/teste-ia-fila.mjs   (de qualquer pasta)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const linha of fs.readFileSync(path.join(raiz, ".env.local"), "utf8").split("\n")) {
  const i = linha.indexOf("=");
  if (i > 0 && !process.env[linha.slice(0, i)]) process.env[linha.slice(0, i)] = linha.slice(i + 1);
}
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const criadas = [];
let ok = 0;
let total = 0;

async function nova(texto) {
  const [d] = await q("insert into demandas (origem, solicitante) values ('mesa', 'TESTE IA (Claude)') returning id");
  const id = Number(d.id);
  criadas.push(id);
  if (texto) await entrada(id, texto);
  return id;
}
async function entrada(id, texto) {
  await q("insert into mensagens (demanda_id, direcao, tipo, texto) values ($1, 'entrada', 'texto', $2)", [id, texto]);
  await q("update demandas set ultima_atividade = now() where id = $1", [id]);
}
async function print(id, arquivo) {
  const caminho = `${id}/teste-${path.basename(arquivo)}`;
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/anexos/${caminho}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`, apikey: process.env.SUPABASE_SECRET_KEY, "Content-Type": "image/png" },
    body: fs.readFileSync(arquivo),
  });
  if (!r.ok) throw new Error(`upload ${r.status} ${await r.text()}`);
  await q("insert into mensagens (demanda_id, direcao, tipo) values ($1, 'entrada', 'imagem')", [id]);
  await q("insert into anexos (demanda_id, storage_path, mimetype, ocr_status) values ($1, $2, 'image/png', 'pendente')", [id, caminho]);
  await q("update demandas set ultima_atividade = now() where id = $1", [id]);
}
/** Espera o worker responder (evento ia_aviso/ocr_aviso novo) e devolve sugestão + última mensagem enviada. */
async function resposta(id, depoisDe, maxMs = 120_000) {
  const ate = Date.now() + maxMs;
  while (Date.now() < ate) {
    const [ev] = await q("select tipo, detalhe, created_at from eventos where demanda_id = $1 and tipo in ('ia_aviso','ocr_aviso') and created_at > $2 order by created_at desc limit 1", [id, depoisDe]);
    if (ev) {
      await dormir(4000); // o worker grava o evento e logo depois manda o WhatsApp
      const [d] = await q("select sugestao from demandas where id = $1", [id]);
      const [m] = await q("select texto from mensagens where demanda_id = $1 and direcao = 'saida' and created_at > $2 order by created_at desc limit 1", [id, depoisDe]);
      return { via: ev.detalhe.via, sugestao: d.sugestao, whatsapp: m?.texto ?? null, uso: ev.detalhe.uso, erro_ia: ev.detalhe.erro_ia };
    }
    await dormir(3000);
  }
  return { timeout: true };
}
function conferir(nome, passou, info) {
  total++;
  if (passou) ok++;
  console.log(`\n${passou ? "✅" : "❌"} ${nome}\n${JSON.stringify(info, null, 1)}`);
}

try {
  let t = new Date();
  const a = await nova("troca o rt da aguas claras pra karol");
  const rA = await resposta(a, t);
  conferir(`#${a} A texto RT`, rA.via === "ia" && rA.sugestao === "rt 6024 karoline" && /Posso fazer\?/.test(rA.whatsapp ?? ""), rA);

  t = new Date();
  await entrada(a, "não, é a micaelli");
  const rD = await resposta(a, t);
  conferir(`#${a} D correção no meio da conversa`, rD.via === "ia" && rD.sugestao === "rt 6024 micaelli", rD);

  t = new Date();
  const b = await nova("deu esse erro aqui");
  await print(b, path.join(raiz, "..", "exemplos", "rejeicao-ibs-cbs-01.png"));
  const rB = await resposta(b, t, 180_000);
  conferir(`#${b} B print IBS/CBS`, rB.via === "ia" && rB.sugestao === "ibs 2609 venda 117327" && /registrar/.test(rB.whatsapp ?? ""), rB);

  t = new Date();
  const cc = await nova("obrigado!");
  const rC = await resposta(cc, t);
  conferir(`#${cc} C "obrigado" não responde`, rC.via === "ia" && !rC.sugestao && !rC.whatsapp, rC);
} finally {
  if (criadas.length) await q("update demandas set status = 'arquivada', sugestao = null where id = any($1)", [criadas]);
  console.log(`\nRESUMO: ${ok}/${total} ok (demandas de teste ${criadas.join(", ")} arquivadas)`);
  await c.end();
}
