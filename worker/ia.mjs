// Entende o pedido (texto do Mateus, mensagem encaminhada do time e prints) com a OpenAI
// e devolve um ATALHO. O atalho passa depois pelo interpretar() de shared/atalhos.mjs,
// que tem as travas (lista de RT etc.): a IA só entende, nunca decide sozinha o que mexer.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RTS } from "../shared/atalhos.mjs";

const run = promisify(execFile);

/** Prepara o print pra IA: foto pequena é ampliada (ajuda a ler dígito), grande é reduzida (economiza). */
export async function prepararImagem(arquivo) {
  const saida = `${arquivo}-ia.jpg`;
  await run("convert", [arquivo, "-resize", "1400x1400<", "-resize", "2000x2000>", "-quality", "85", saida]);
  return saida;
}

export const MODELO_IA = process.env.OPENAI_MODELO || "gpt-5.4-mini";

const empresasRt = Object.entries(RTS)
  .map(([cod, e]) => `${cod} (${e.nome}): ${e.opcoes.map((o) => o.split(" ")[0]).join(", ")}`)
  .join("; ");

const INSTRUCOES = `Você é o NEXO Suporte. O Mateus manda pedidos de suporte do ERP Sempre da Winner: texto dele, mensagem encaminhada de um funcionário, e/ou prints da tela.
Sua tarefa: identificar qual correção é pedida e devolver o ATALHO correspondente.
Regras:
- Nunca invente códigos ou números: use só o que aparece no texto ou nos prints. Se faltar algo, pergunte (uma pergunta curta).
- Se a conversa já tem uma sugestão sua e o Mateus corrigiu algo, refaça o atalho com a correção dele.
- Se a mensagem não for um pedido (ex.: "obrigado"), devolva atalho null e pergunta null.
Atalhos válidos:
- Trocar RT (responsável técnico da etiqueta): "rt <empresa> <primeiro nome>". Empresas e nomes permitidos: ${empresasRt}. "Águas Claras" = 6024; "DF140"/"DF 140" = 6148. Apelidos (ex.: Karol, Mica) valem pelo nome mais parecido da lista da empresa.
- Duplicar tributação (erro "Tributação não cadastrada corretamente" ao inserir item na venda): "trib <códigos dos itens com erro> <código de UM item que já entrou na mesma nota>" (o último número é o item que está OK). Se houver vários itens OK, escolha o de nome mais parecido com o item com erro.
  Como ler a tela da venda: o item COM ERRO é o que está no campo "Cód. prd/Srv." do formulário de cima (o item que estava sendo inserido, ao lado da "Descrição"). Os itens da LISTA/GRADE de baixo (colunas Item, Local de estoque, Cód. prd/srv.) JÁ ENTRARAM na nota, então estão OK, mesmo que a faixa vermelha de erro apareça acima deles. Na grade o código pode ter ponto de milhar (3.647 = 3647).
  Fotos de tela costumam ser borradas: se não tiver certeza de um dígito, pergunte em vez de chutar.
- IBS/CBS (rejeição "Configuração de IBS e CBS necessária"): "ibs <códigos dos produtos> venda <número da venda>"; acrescente " outros" no fim se o tipo de operação da venda for Outros. Se o tipo de operação não aparecer, use Venda.
- Produto de corte: "corte <código do produto de origem>".
- Outra rejeição de nota: "rej <código da rejeição>".
- Cancelar nota: "cancelar <número da nota>".
Códigos de produto/venda/nota são só os dígitos (sem ponto).
Responda SÓ com JSON: {"atalho": string|null, "explicacao": string, "pergunta": string|null}
- atalho: null quando não der pra montar com segurança (aí "pergunta" é obrigatória, a não ser que não seja um pedido).
- explicacao: uma frase curta, em português, com o que você viu. Sempre que tirar um código de produto de um print, escreva o código JUNTO com o nome do produto que aparece ao lado (ex.: "item 3575 BOBINA DE TNT"), pra o Mateus conferir. Se o print for foto da tela (borrada/torta), termine com "(foto: confira os números)". Sem repetir o atalho.`;

/**
 * @param {{conversa: {papel: "mateus"|"sistema", texto: string}[], imagens: {base64: string, mime: string}[]}} entrada
 * @returns {Promise<{atalho: string|null, explicacao: string, pergunta: string|null, uso: object, modelo: string}>}
 */
export async function entenderPedido({ conversa, imagens }) {
  const mensagens = [{ role: "system", content: INSTRUCOES }];
  for (const m of conversa) mensagens.push({ role: m.papel === "mateus" ? "user" : "assistant", content: m.texto });
  if (imagens.length) {
    mensagens.push({
      role: "user",
      content: [
        { type: "text", text: `Prints enviados (${imagens.length}):` },
        ...imagens.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.base64}`, detail: "high" } })),
      ],
    });
  }
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODELO_IA, messages: mensagens, response_format: { type: "json_object" }, max_completion_tokens: 500 }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${json?.error?.message ?? "erro"}`);
  const resp = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
  return {
    atalho: typeof resp.atalho === "string" && resp.atalho.trim() ? resp.atalho.trim() : null,
    explicacao: typeof resp.explicacao === "string" ? resp.explicacao.trim() : "",
    pergunta: typeof resp.pergunta === "string" && resp.pergunta.trim() ? resp.pergunta.trim() : null,
    uso: json.usage ?? {},
    modelo: json.model ?? MODELO_IA,
  };
}
