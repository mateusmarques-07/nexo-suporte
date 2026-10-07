// Cliente mínimo da uazapi (WhatsApp do NEXO Suporte, 61 99400-8073).
// Só roda no servidor: o token da instância nunca vai pro navegador.

const BASE = () => process.env.UAZAPI_URL!;
const TOKEN = () => process.env.UAZAPI_TOKEN!;

async function chamar(caminho: string, corpo?: unknown, metodo = "POST") {
  const r = await fetch(`${BASE()}${caminho}`, {
    method: metodo,
    headers: { token: TOKEN(), "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    cache: "no-store",
  });
  const texto = await r.text();
  let json: unknown = null;
  try {
    json = JSON.parse(texto);
  } catch {
    json = { texto };
  }
  if (!r.ok) throw new Error(`uazapi ${caminho} ${r.status}: ${texto.slice(0, 200)}`);
  return json as Record<string, unknown>;
}

/** Envia texto. Não faz retry: um timeout pode já ter enviado (doc da uazapi). */
export function enviarTexto(numero: string, texto: string) {
  return chamar("/send/text", { number: numero, text: texto });
}

/** Gera uma URL temporária (2 dias) pra baixar a mídia de uma mensagem recebida. */
export async function urlDaMidia(idMensagem: string): Promise<{ url: string; mimetype: string | null }> {
  const r = await chamar("/message/download", { id: idMensagem, return_link: true });
  const url = (r.fileURL ?? r.fileUrl ?? r.url) as string | undefined;
  if (!url) throw new Error("uazapi não devolveu fileURL");
  return { url, mimetype: (r.mimetype as string) ?? null };
}
