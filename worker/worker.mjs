// Worker do NEXO Suporte no VPS (serviço systemd "nexo-suporte-worker").
// 1. Lê os prints que chegaram (Tesseract) e manda sugestão de atalho pro Mateus.
// 2. Vigia a conexão da uazapi e grava em "saude" (a mesa mostra o alerta).
// 3. Batimento: grava que o worker está vivo.
// 4. Fila de correções no Sempre (uma por vez): roda a solução pronta, sobe os prints
//    e manda o resultado + resposta pronta pro Mateus.
// 5. Alerta por e-mail (n8n) quando o WhatsApp do sistema cai e quando volta.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { analisar, mensagemSugestao } from "../shared/ocr-regras.mjs";
import { respostaPadrao } from "../shared/respostas.mjs";
import { interpretar } from "../shared/atalhos.mjs";
import { entenderPedido, prepararImagem } from "./ia.mjs";

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

// Quando o Mateus para de mandar coisa numa demanda (12 s de silêncio), a IA lê
// a conversa + prints e responde UMA vez: "Entendi: ... Posso fazer?" ou uma pergunta.
// Se ele responder corrigindo, a demanda é lida de novo (mensagem mais nova que o último aviso).
// Sem IA (sem chave ou OpenAI fora): cai na leitura antiga dos prints (Tesseract + regras).
async function sugerir() {
  const corte = new Date(Date.now() - 12_000).toISOString();
  const { data: abertas } = await db
    .from("demandas")
    .select("id")
    .eq("status", "recebida")
    .is("comando", null)
    .lt("ultima_atividade", corte)
    .gt("created_at", new Date(Date.now() - 6 * 3600_000).toISOString())
    .limit(10);
  for (const d of abertas ?? []) {
    const [{ data: msgs }, { data: anexos }, { data: avisos }] = await Promise.all([
      db.from("mensagens").select("direcao, texto, created_at").eq("demanda_id", d.id).order("created_at"),
      db.from("anexos").select("storage_path, mimetype, ocr_status, ocr_dados, created_at").eq("demanda_id", d.id).order("created_at"),
      db.from("eventos").select("created_at").eq("demanda_id", d.id).in("tipo", ["ocr_aviso", "ia_aviso"]).order("created_at", { ascending: false }).limit(1),
    ]);
    const entradas = (msgs ?? []).filter((m) => m.direcao === "entrada");
    if (!entradas.length) continue;
    const ultimaEntrada = Math.max(...entradas.map((m) => new Date(m.created_at).getTime()));
    if (avisos?.[0] && new Date(avisos[0].created_at).getTime() >= ultimaEntrada) continue; // já respondido
    const recebidos = (anexos ?? []).filter((a) => !a.storage_path.includes("/sempre-"));
    if (recebidos.some((x) => x.ocr_status === "pendente")) continue; // espera o OCR (plano B)

    let texto;
    let sugestao = null;
    let detalhe;
    try {
      if (!process.env.OPENAI_API_KEY) throw new Error("sem OPENAI_API_KEY");
      const r = await lerComIa(msgs, recebidos);
      const a = r.atalho ? interpretar(r.atalho) : null;
      const valido = a?.acao === "pedido" && !a.erro;
      sugestao = valido ? a.comando : null;
      texto = await textoDaIa(d.id, r, a, valido);
      detalhe = { via: "ia", modelo: r.modelo, atalho_ia: r.atalho, sugestao, uso: r.uso };
    } catch (err) {
      log("ia falhou", d.id, String(err));
      const analises = recebidos.map((x) => x.ocr_dados).filter(Boolean);
      if (analises.length) ({ sugestao, texto } = mensagemSugestao(d.id, analises));
      else texto = `#${d.id}: não consegui entender agora. Tente de novo em instantes ou mande o atalho (ex.: rt 6024 karoline).`;
      detalhe = { via: "regras", erro_ia: String(err).slice(0, 300), sugestao };
    }

    // sugestão nova substitui a anterior (o "sim" confirma sempre a mais recente)
    await db.from("demandas").update({ sugestao, updated_at: new Date().toISOString() }).eq("id", d.id);
    await db.from("eventos").insert({ demanda_id: d.id, tipo: detalhe.via === "ia" ? "ia_aviso" : "ocr_aviso", detalhe });
    if (texto) {
      try {
        await enviar(d.id, texto);
      } catch (err) {
        await db.from("eventos").insert({ demanda_id: d.id, tipo: "erro_envio", detalhe: { erro: String(err) } });
      }
    }
    log("sugestão", d.id, detalhe.via, sugestao ?? "(sem sugestão)");
  }
}

/** Monta a conversa (Mateus × sistema) e os prints recebidos e pergunta pra IA. */
async function lerComIa(msgs, anexos) {
  const conversa = msgs
    .filter((m) => m.texto)
    .map((m) => ({ papel: m.direcao === "entrada" ? "mateus" : "sistema", texto: m.texto }));
  const imagens = [];
  for (const a of anexos.filter((x) => x.mimetype?.startsWith("image/")).slice(-4)) {
    const local = path.join(TMP, `ia-${path.basename(a.storage_path)}`);
    try {
      const { data: blob, error } = await db.storage.from("anexos").download(a.storage_path);
      if (error) throw new Error(error.message);
      fs.writeFileSync(local, Buffer.from(await blob.arrayBuffer()));
      const pronto = await prepararImagem(local);
      imagens.push({ base64: fs.readFileSync(pronto).toString("base64"), mime: "image/jpeg" });
      fs.rmSync(pronto, { force: true });
    } finally {
      fs.rmSync(local, { force: true });
    }
  }
  if (!conversa.length && !imagens.length) throw new Error("demanda sem texto nem print");
  return entenderPedido({ conversa, imagens });
}

async function textoDaIa(id, r, a, valido) {
  const viu = r.explicacao ? `\n${r.explicacao}` : "";
  if (valido) {
    if (a.tipo === "canc")
      return `Entendi #${id}: ${a.resumo}.${viu}\nCancelamento nunca é automático: responda *sim* só pra registrar na mesa.`;
    const { data: sol } = await db.from("solucoes").select("pronta").eq("chave", a.tipo).maybeSingle();
    return sol?.pronta
      ? `Entendi #${id}: ${a.resumo}.${viu}\nPosso fazer? Responda *sim*.`
      : `Entendi #${id}: ${a.resumo}.${viu}\nEssa correção ainda é feita à mão. Responda *sim* pra registrar na mesa.`;
  }
  if (r.pergunta) return `#${id}: ${r.pergunta}`;
  if (a?.erro) return `#${id}: ${a.erro}`;
  return null; // não era pedido (ex.: "obrigado"): não responde nada
}

// ---------- correções no Sempre ----------
// Cada solução pronta: script em worker/solucoes/ e como montar os argumentos a partir dos params.
const SOLUCOES = {
  rt: { script: "solucoes/rt.mjs", args: (pr) => [pr.empresa, pr.rt] },
};
const PRAZO_FILA_MS = 30 * 60_000; // pedido mais velho que isso não roda (evita corrigir algo antigo por acidente)

const nomeCurto = (rt) => String(rt ?? "").split(" - ")[0];

function ultimoJson(texto) {
  const linhas = String(texto ?? "").trim().split("\n").reverse();
  for (const l of linhas) {
    try {
      return JSON.parse(l);
    } catch {}
  }
  return null;
}

function textoResultado(d, r) {
  const resp = respostaPadrao(d.tipo, d.params);
  if (d.tipo === "rt" && r.ok && r.mudou)
    return `✅ #${d.id} feito no Sempre.\nRT da ${r.empresa}: ${nomeCurto(r.antes)} → ${nomeCurto(r.depois)} (conferido depois de salvar).\n\nResposta pronta pro time:\n${resp}`;
  if (d.tipo === "rt" && r.ok)
    return `✅ #${d.id}: o RT da ${r.empresa} já era ${nomeCurto(r.antes)}. Não precisei mudar nada.\n\nResposta pronta pro time:\n${resp}`;
  return `⚠️ #${d.id} não consegui corrigir no Sempre.\nMotivo: ${r.erro ?? "desconhecido"}\nNada foi dado como feito. Veja na mesa.`;
}

async function corrigir() {
  const { data: prontas } = await db.from("solucoes").select("chave").eq("pronta", true);
  const chaves = (prontas ?? []).map((s) => s.chave).filter((k) => SOLUCOES[k]);
  if (!chaves.length) return;
  const { data: fila } = await db
    .from("demandas")
    .select("id, tipo, params")
    .eq("status", "entendida")
    .in("tipo", chaves)
    .gt("correcao_pedida_em", new Date(Date.now() - PRAZO_FILA_MS).toISOString())
    .order("correcao_pedida_em")
    .limit(1);
  const d = fila?.[0];
  if (!d) return;
  // reserva: só segue se ninguém mudou a demanda no meio do caminho
  const { data: pegou } = await db
    .from("demandas")
    .update({ status: "corrigindo", correcao_pedida_em: null, updated_at: new Date().toISOString() })
    .eq("id", d.id)
    .eq("status", "entendida")
    .select("id");
  if (!pegou?.length) return;
  await db.from("eventos").insert({ demanda_id: d.id, tipo: "correcao_inicio", detalhe: { tipo: d.tipo, params: d.params } });
  log("corrigindo", d.id, d.tipo);

  const sol = SOLUCOES[d.tipo];
  const pasta = path.join(TMP, `correcao-${d.id}-${Date.now()}`);
  let r;
  try {
    const { stdout } = await run("node", [path.join(aqui, sol.script), ...sol.args(d.params), pasta], { timeout: 5 * 60_000, maxBuffer: 4e6 });
    r = ultimoJson(stdout) ?? { ok: false, erro: "a solução não devolveu resultado" };
  } catch (err) {
    r = ultimoJson(err.stdout) ?? { ok: false, erro: err.killed ? "passou de 5 minutos" : String(err.message ?? err).slice(0, 300) };
  }

  // prints do Sempre vão pro bucket, ao lado dos prints recebidos (prefixo "sempre-")
  const prints = [];
  for (const arq of r.prints ?? []) {
    if (!fs.existsSync(arq)) continue;
    const caminho = `${d.id}/sempre-${Date.now()}-${path.basename(arq)}`;
    const { error } = await db.storage.from("anexos").upload(caminho, fs.readFileSync(arq), { contentType: "image/png" });
    if (error) continue;
    await db.from("anexos").insert({ demanda_id: d.id, storage_path: caminho, mimetype: "image/png", ocr_status: "ignorado" });
    prints.push(caminho);
  }
  fs.rmSync(pasta, { recursive: true, force: true });

  const { prints: _locais, ...detalhe } = r;
  await db.from("demandas").update({ status: r.ok ? "corrigida" : "erro", updated_at: new Date().toISOString() }).eq("id", d.id);
  await db.from("eventos").insert({ demanda_id: d.id, tipo: r.ok ? "correcao_ok" : "correcao_erro", detalhe: { ...detalhe, prints } });
  log("correção", d.id, r.ok ? "ok" : "erro", r.erro ?? "");

  try {
    await enviar(d.id, textoResultado(d, r));
    const ultimo = prints[prints.length - 1];
    if (ultimo) {
      const { data: link } = await db.storage.from("anexos").createSignedUrl(ultimo, 600);
      if (link?.signedUrl) await uazapi("/send/media", { number: NUMERO, type: "image", file: link.signedUrl, text: `#${d.id} · tela do Sempre` });
    }
  } catch (err) {
    await db.from("eventos").insert({ demanda_id: d.id, tipo: "erro_envio", detalhe: { erro: String(err) } });
  }
}

// ---------- alerta por e-mail (n8n "Alerta | NEXO Suporte" → Gmail do Mateus) ----------
async function alertarEmail(assunto, texto) {
  if (!process.env.ALERTA_WEBHOOK_URL) return log("alerta sem webhook configurado:", assunto);
  try {
    const r = await fetch(process.env.ALERTA_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-segredo": process.env.ALERTA_WEBHOOK_SECRET ?? "" },
      body: JSON.stringify({ assunto, texto }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    log("alerta enviado:", assunto);
  } catch (err) {
    log("alerta falhou:", assunto, String(err));
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
  // e-mail só depois de 2 checagens seguidas com problema (~10 min), pra não alarmar por falha passageira
  if (status === "connected") {
    if (alertaUazapiEnviado) await alertarEmail("WhatsApp do sistema voltou", "O número 61 99400-8073 do NEXO Suporte está conectado de novo.");
    falhasUazapi = 0;
    alertaUazapiEnviado = false;
  } else if (++falhasUazapi >= 2 && !alertaUazapiEnviado) {
    alertaUazapiEnviado = true;
    await alertarEmail(
      "WhatsApp do sistema caiu",
      `O número 61 99400-8073 do NEXO Suporte está "${status}" há pelo menos 10 minutos.\n` +
        `Motivo informado: ${detalhe.motivo ?? detalhe.erro ?? "não informado"}.\n\n` +
        "Enquanto isso o time não recebe o \"Recebi\". Pra voltar: abrir o painel da uazapi (instância rei-do-corte) e ler o QR Code com o celular do número."
    );
  }
}
let falhasUazapi = 0;
let alertaUazapiEnviado = false;

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
    await corrigir();
  } catch (err) {
    log("erro no laço", String(err));
  }
  await dormir(5000);
}
