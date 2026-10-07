// Lê o JSON que a uazapi manda no webhook "messages" e devolve só o que interessa.
// O formato exato do payload não está na documentação pública, então a leitura é
// tolerante (aceita os nomes de campo das versões conhecidas) e o JSON bruto fica
// guardado em mensagens.raw pra conferência.

export type Entrada = {
  id: string | null;
  remetente: string | null; // número de quem mandou
  // Todas as identidades que vieram (telefone e/ou LID). Desde 2026 o WhatsApp
  // manda o "sender" como LID (ex.: 1234567890@lid) e o telefone só em chat.phone.
  identidades: string[];
  deMim: boolean; // mandada pela própria conta do NEXO Suporte
  pelaApi: boolean;
  grupo: boolean;
  tipo: "texto" | "imagem" | "documento" | "outro";
  texto: string | null;
  mimetype: string | null;
};

type Obj = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

export function lerEntrada(body: Obj): Entrada | null {
  const m = (body.message ?? body.data ?? null) as Obj | null;
  if (!m || typeof m !== "object") return null;
  const chat = (body.chat ?? {}) as Obj;

  const id = s(m.messageid) ?? s(m.id) ?? s((m.key as Obj | undefined)?.id);
  const remetente =
    s(m.sender_pn) ?? s(m.sender) ?? s(m.chatid) ?? s(chat.wa_chatid) ?? s(chat.phone) ?? null;
  const deMim = m.fromMe === true || (m.key as Obj | undefined)?.fromMe === true;
  const pelaApi = m.wasSentByApi === true;
  const grupo = m.isGroup === true || String(m.chatid ?? "").endsWith("@g.us");

  const tipoBruto = String(m.messageType ?? m.type ?? m.mediaType ?? "").toLowerCase();
  const mimetype = s(m.mimetype) ?? s((m.content as Obj | undefined)?.mimetype) ?? null;
  let tipo: Entrada["tipo"] = "outro";
  if (tipoBruto.includes("image") || (mimetype ?? "").startsWith("image/")) tipo = "imagem";
  else if (tipoBruto.includes("document") || (mimetype ?? "").includes("pdf")) tipo = "documento";
  else if (tipoBruto.includes("conversation") || tipoBruto.includes("text") || tipoBruto === "") tipo = "texto";

  const conteudo = m.content as Obj | string | undefined;
  const texto =
    s(m.text) ??
    (typeof conteudo === "string" ? s(conteudo) : s(conteudo?.text) ?? s(conteudo?.caption)) ??
    s(m.caption) ??
    null;
  if (tipo === "outro" && texto) tipo = "texto";

  const identidades = [m.sender_pn, m.sender, m.chatid, chat.phone, chat.wa_chatid, chat.wa_chatlid]
    .map(s)
    .filter((x): x is string => !!x);

  return { id, remetente, identidades, deMim, pelaApi, grupo, tipo, texto, mimetype };
}
