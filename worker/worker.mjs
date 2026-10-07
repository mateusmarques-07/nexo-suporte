// Worker do NEXO Suporte no VPS (serviço systemd "nexo-suporte-worker").
// 1. Lê os prints que chegaram (Tesseract) e manda sugestão de atalho pro Mateus.
// 2. Vigia a conexão da uazapi e grava em "saude" (a mesa mostra o alerta).
// 3. Batimento: grava que o worker está vivo.
// Fases seguintes: executar as correções no Sempre (fila, uma por vez).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { analisar, mensagemSugestao } from "../shared/ocr-regras.mjs";

const run = promisify(execFile);
const aqui = path.dirname(fileURLToPath(import.meta.url));
for (const linha of fs.readFileSync(path.join(aqui, "..", ".env.local"), "utf8").split("\n")) {
  const i = linha.indexOf("=");
  if (i > 0 && !process.env[linha.slice(0, i)]) process.env[linha.slice(0, i)] = linha.slice(i + 1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const UAZ = process.env.UAZAPI_URL;
const UAZ_TOKEN = process.env.UAZAPI_TOKEN;
const NUMERO = process.env.NUMERO_AUTORIZADO;
const TMP = path.join(os.tmpdir(), "nexo-suporte-ocr");
fs.mkdirSync(TMP, { recursive: true });

const log = (...a) => console.log(new Date().toISOString(), ...a);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function uazapi(caminho, corpo, metodo = "POST") {
  const r = await fetch(`${UAZ}${caminho}`, {
    method: metodo,
    headers: { token: UAZ_TOKEN, "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${caminho} ${r.status} ${txt.slice(0, 200)}`);
  try {
    return JSON.parse(txt);
  } catch {
    return {};
  }
}

async function enviar(demandaId, texto) {
  await uazapi("/send/text", { number: NUMERO, text: texto });
  await db.from("mensagens").insert({ demanda_id: demandaId, direcao: "saida", tipo: "texto", texto });
}

// ---------- leitura dos prints ----------
async function lerImagem(arquivo) {
  const tess = async (f, psm) => (await run("tesseract", [f, "-", "-l", "por", "--psm", String(psm)], { maxBuffer: 8e6 })).stdout;
  let texto = await tess(arquivo, 3);
  const letras = (texto.match(/[A-Za-zÀ-ú]/g) ?? []).length;
  if (letras < 80) {
    // foto da tela: aumenta, cinza e contraste ajudam o Tesseract
    const tratado = arquivo.replace(/(\.\w+)$/, "-p.png");
    await run("convert", [arquivo, "-resize", "300%", "-colorspace", "Gray", "-normalize", "-sharpen", "0x1", tratado]);
    texto = `${texto}\n${await tess(tratado, 6)}`;
    fs.rmSync(tratado, { force: true });
  }
  return texto.trim();
}

async function processarOcr() {
  const { data: pend } = await db.from("anexos").select("id, demanda_id, storage_path").eq("ocr_status", "pendente").order("created_at").limit(5);
  for (const a of pend ?? []) {
    const local = path.join(TMP, path.basename(a.storage_path));
    try {
      const { data: blob, error } = await db.storage.from("anexos").download(a.storage_path);
      if (error) throw new Error(error.message);
      fs.writeFileSync(local, Buffer.from(await blob.arrayBuffer()));
      const texto = await lerImagem(local);
      const dados = analisar(texto);
      await db.from("anexos").update({ ocr_status: "ok", ocr_texto: texto.slice(0, 20000), ocr_dados: dados }).eq("id", a.id);
      log("ocr ok", a.demanda_id, dados?.tipo ?? "-");
    } catch (err) {
      await db.from("anexos").update({ ocr_status: "erro", ocr_texto: String(err).slice(0, 500) }).eq("id", a.id);
      log("ocr erro", a.demanda_id, String(err));
    } finally {
      fs.rmSync(local, { force: true });
    }
  }
}

// Depois que os prints de uma demanda foram lidos (e o Mateus parou de mandar
// coisa há 20 s), manda UMA mensagem com o que foi entendido.
async function sugerir() {
  const corte = new Date(Date.now() - 20_000).toISOString();
  const { data: abertas } = await db
    .from("demandas")
    .select("id")
    .eq("status", "recebida")
    .is("comando", null)
    .is("sugestao", null)
    .lt("ultima_atividade", corte)
    .gt("created_at", new Date(Date.now() - 6 * 3600_000).toISOString())
    .limit(10);
  for (const d of abertas ?? []) {
    const [{ data: anexos }, { data: avisado }] = await Promise.all([
      db.from("anexos").select("ocr_status, ocr_dados").eq("demanda_id", d.id),
      db.from("eventos").select("id").eq("demanda_id", d.id).eq("tipo", "ocr_aviso").limit(1),
    ]);
    if (!anexos?.length || avisado?.length) continue;
    if (anexos.some((x) => x.ocr_status === "pendente")) continue;
    const analises = anexos.map((x) => x.ocr_dados).filter(Boolean);
    const { sugestao, texto } = mensagemSugestao(d.id, analises);
    if (sugestao) await db.from("demandas").update({ sugestao, updated_at: new Date().toISOString() }).eq("id", d.id);
    await db.from("eventos").insert({ demanda_id: d.id, tipo: "ocr_aviso", detalhe: { sugestao } });
    try {
      await enviar(d.id, texto);
    } catch (err) {
      await db.from("eventos").insert({ demanda_id: d.id, tipo: "erro_envio", detalhe: { erro: String(err) } });
    }
    log("sugestão enviada", d.id, sugestao ?? "(sem sugestão)");
  }
}

// ---------- saúde ----------
let ultimoStatusUazapi = null;
async function checarUazapi() {
  let status = "erro";
  let detalhe = {};
  try {
    const r = await uazapi("/instance/status", undefined, "GET");
    const inst = r.instance ?? r;
    status = inst.status ?? "desconhecido";
    detalhe = { numero: inst.owner ?? null, motivo: inst.lastDisconnectReason ?? null };
  } catch (err) {
    detalhe = { erro: String(err).slice(0, 300) };
  }
  await db.from("saude").upsert({ chave: "uazapi", status, verificado_em: new Date().toISOString(), detalhe });
  if (status !== ultimoStatusUazapi) {
    await db.from("eventos").insert({ tipo: "uazapi_status", detalhe: { de: ultimoStatusUazapi, para: status, ...detalhe } });
    log("uazapi", ultimoStatusUazapi, "→", status);
    ultimoStatusUazapi = status;
  }
}

async function batimento() {
  await db.from("saude").upsert({ chave: "worker", status: "ligado", verificado_em: new Date().toISOString(), detalhe: { host: os.hostname() } });
}

// ---------- laço principal ----------
let ultimoUazapi = 0;
let ultimoBatimento = 0;
log("worker iniciado");
for (;;) {
  try {
    if (Date.now() - ultimoBatimento > 60_000) {
      await batimento();
      ultimoBatimento = Date.now();
    }
    if (Date.now() - ultimoUazapi > 5 * 60_000) {
      await checarUazapi();
      ultimoUazapi = Date.now();
    }
    await processarOcr();
    await sugerir();
  } catch (err) {
    log("erro no laço", String(err));
  }
  await dormir(5000);
}
