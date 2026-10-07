// Receptor do webhook da uazapi. O Mateus encaminha pedidos pro WhatsApp do
// NEXO Suporte; aqui viram demandas na mesa. Só aceita mensagens do número dele.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enviarTexto, urlDaMidia } from "@/lib/uazapi";
import { lerEntrada } from "@/lib/whatsapp-entrada";
import { AJUDA, interpretar, mesmoNumero } from "../../../../shared/atalhos.mjs";

export const maxDuration = 30;

const RODAPE = "Por enquanto a correção no Sempre ainda não é automática: ficou registrado na sua mesa.";

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("k") !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: true });
  if (typeof body.token === "string" && body.token !== process.env.UAZAPI_TOKEN) {
    return NextResponse.json({ erro: "instância desconhecida" }, { status: 401 });
  }

  const db = createAdminClient();
  const evento = String(body.EventType ?? body.event ?? "");

  if (evento === "connection") {
    const estado = String((body.instance as Record<string, unknown> | undefined)?.status ?? body.status ?? "desconhecido");
    await db.from("saude").upsert({ chave: "uazapi", status: estado, verificado_em: new Date().toISOString(), detalhe: { via: "webhook" } });
    return NextResponse.json({ ok: true });
  }
  if (evento && evento !== "messages") return NextResponse.json({ ok: true });

  const e = lerEntrada(body);
  if (!e || e.deMim || e.pelaApi || e.grupo) return NextResponse.json({ ok: true });

  const autorizado = process.env.NUMERO_AUTORIZADO!;
  const lid = process.env.LID_AUTORIZADO ?? "";
  const ehMateus = e.identidades.some((x) => (x.endsWith("@lid") ? !!lid && x === lid : mesmoNumero(x, autorizado)));
  if (!ehMateus) {
    await db.from("eventos").insert({ tipo: "remetente_ignorado", detalhe: { identidades: e.identidades } });
    return NextResponse.json({ ok: true });
  }

  // a uazapi pode reenviar o mesmo evento; o wa_id único evita duplicar
  if (e.id) {
    const { data: ja } = await db.from("mensagens").select("id").eq("wa_id", e.id).maybeSingle();
    if (ja) return NextResponse.json({ ok: true, duplicada: true });
  }

  const responder = async (texto: string, demandaId: number | null) => {
    try {
      await enviarTexto(autorizado, texto);
      await db.from("mensagens").insert({ demanda_id: demandaId, direcao: "saida", tipo: "texto", texto });
    } catch (err) {
      await db.from("eventos").insert({ demanda_id: demandaId, tipo: "erro_envio", detalhe: { erro: String(err) } });
    }
  };

  const atalho = e.tipo === "texto" ? interpretar(e.texto) : null;

  if (atalho?.acao === "ajuda") {
    await db.from("mensagens").insert({ wa_id: e.id, direcao: "entrada", tipo: "texto", texto: e.texto, raw: body });
    await responder(AJUDA, null);
    return NextResponse.json({ ok: true });
  }

  if (atalho?.acao === "nova") {
    await db
      .from("demandas")
      .update({ ultima_atividade: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
      .in("status", ["recebida", "entendida"])
      .gt("ultima_atividade", new Date(Date.now() - 10 * 60 * 1000).toISOString());
    await db.from("mensagens").insert({ wa_id: e.id, direcao: "entrada", tipo: "texto", texto: e.texto, raw: body });
    await responder("Ok. O próximo envio abre uma demanda nova.", null);
    return NextResponse.json({ ok: true });
  }

  if (atalho?.acao === "ok") {
    const { data: d } = await db
      .from("demandas")
      .select("id, sugestao")
      .not("sugestao", "is", null)
      .is("comando", null)
      .gt("created_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    await db.from("mensagens").insert({ demanda_id: d?.id ?? null, wa_id: e.id, direcao: "entrada", tipo: "texto", texto: e.texto, raw: body });
    const sugerido = d?.sugestao ? interpretar(d.sugestao) : null;
    if (!d || !sugerido || sugerido.acao !== "pedido" || sugerido.erro) {
      await responder("Não achei nenhuma sugestão esperando confirmação. Mande o atalho direto (ex.: trib 3575 3647).", null);
      return NextResponse.json({ ok: true });
    }
    await db
      .from("demandas")
      .update({ tipo: sugerido.tipo, comando: sugerido.comando, params: sugerido.params, resumo: sugerido.resumo, status: "entendida", updated_at: new Date().toISOString() })
      .eq("id", d.id);
    await db.from("eventos").insert({ demanda_id: d.id, tipo: "sugestao_aceita", detalhe: { comando: sugerido.comando } });
    await responder(`Confirmado #${d.id}: ${sugerido.resumo}.\n${RODAPE}`, d.id);
    return NextResponse.json({ ok: true });
  }

  // pedido normal: texto, atalho ou print. Junta na demanda aberta (até 3 min) ou abre outra.
  const { data: abriu, error: erroAbrir } = await db.rpc("pegar_ou_abrir_demanda", { janela_min: 3, forcar_nova: false });
  if (erroAbrir || !abriu?.[0]) {
    return NextResponse.json({ erro: erroAbrir?.message ?? "sem demanda" }, { status: 500 });
  }
  const demandaId = Number(abriu[0].demanda_id);
  const nova = Boolean(abriu[0].nova);

  const { data: msg } = await db
    .from("mensagens")
    .insert({ demanda_id: demandaId, wa_id: e.id, direcao: "entrada", tipo: e.tipo, texto: e.texto, raw: body })
    .select("id")
    .single();

  if ((e.tipo === "imagem" || e.tipo === "documento") && e.id) {
    try {
      const midia = await urlDaMidia(e.id);
      const arquivo = await fetch(midia.url, { cache: "no-store" });
      const bytes = new Uint8Array(await arquivo.arrayBuffer());
      const mime = midia.mimetype ?? e.mimetype ?? arquivo.headers.get("content-type") ?? "application/octet-stream";
      const ext = mime.includes("png") ? "png" : mime.includes("pdf") ? "pdf" : mime.includes("webp") ? "webp" : "jpg";
      const caminho = `${demandaId}/${msg?.id ?? e.id}.${ext}`;
      const { error: erroUp } = await db.storage.from("anexos").upload(caminho, bytes, { contentType: mime, upsert: true });
      if (erroUp) throw new Error(erroUp.message);
      await db.from("anexos").insert({
        demanda_id: demandaId,
        mensagem_id: msg?.id ?? null,
        storage_path: caminho,
        mimetype: mime,
        ocr_status: mime.startsWith("image/") ? "pendente" : "ignorado",
      });
    } catch (err) {
      await db.from("eventos").insert({ demanda_id: demandaId, tipo: "erro_midia", detalhe: { erro: String(err) } });
    }
  }

  let resposta: string | null = null;
  if (atalho?.acao === "pedido") {
    if (atalho.erro) {
      resposta = `#${demandaId}: ${atalho.erro}`;
    } else {
      await db
        .from("demandas")
        .update({ tipo: atalho.tipo, comando: atalho.comando, params: atalho.params, resumo: atalho.resumo, status: "entendida", updated_at: new Date().toISOString() })
        .eq("id", demandaId);
      await db.from("eventos").insert({ demanda_id: demandaId, tipo: "atalho", detalhe: { comando: atalho.comando } });
      resposta = nova
        ? `Recebi. Demanda #${demandaId} aberta.\nEntendi: ${atalho.resumo}.\n${RODAPE}`
        : `Entendi #${demandaId}: ${atalho.resumo}.\n${RODAPE}`;
    }
  } else if (nova) {
    await db.from("eventos").insert({ demanda_id: demandaId, tipo: "aberta", detalhe: { via: "whatsapp" } });
    resposta =
      `Recebi. Demanda #${demandaId} aberta.\n` +
      (e.tipo === "imagem"
        ? "Vou ler o print e te mando uma sugestão de atalho."
        : "Pode mandar os prints. Se já souber, mande o atalho (ex.: trib 3575 3647). Digite ajuda pra ver todos.");
  }
  if (resposta) await responder(resposta, demandaId);

  return NextResponse.json({ ok: true, demanda: demandaId });
}

export async function GET() {
  return NextResponse.json({ ok: true, servico: "nexo-suporte whatsapp" });
}
