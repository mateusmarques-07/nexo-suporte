// Regras fixas pra entender o texto lido (Tesseract) dos prints do Sempre.
// Print de tela lê bem; foto da tela tirada com celular costuma trocar dígitos,
// então quando a leitura é fraca só identificamos o tipo e pedimos os códigos.

const limpa = (t) => String(t ?? "").replace(/\r/g, "");

export function analisar(textoBruto) {
  const t = limpa(textoBruto);
  const plano = t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  if (/ibs e cbs|ibs\/cbs|configuracao de ibs/.test(plano)) {
    const venda = t.match(/Nr\.?\s*Venda:?\s*(\d[\d.]{3,})/i)?.[1]?.replace(/\./g, "") ?? null;
    const produtos = [...t.matchAll(/^\s*(\d{2,6})\s*-\s*[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/gm)].map((m) => m[1]);
    const unicos = [...new Set(produtos)];
    return {
      tipo: "ibs",
      titulo: "Configuração de IBS e CBS necessária",
      venda,
      produtos: unicos,
      sugestao: unicos.length ? `ibs ${unicos.join(",")}${venda ? ` venda ${venda}` : ""}` : null,
    };
  }

  if (/tributacao nao cadastrada/.test(plano)) {
    const cliente = t.match(/Cliente:?\s*(\d{2,6})/i)?.[1] ?? null;
    const numeros = [...new Set((t.match(/\b\d{1,2}\.\d{3}\b|\b\d{3,5}\b/g) ?? []).map((n) => n.replace(/\./g, "")))].filter(
      (n) => n !== cliente && !/^(19|20)\d{2}$/.test(n)
    );
    return { tipo: "trib", titulo: "Tributação não cadastrada", cliente, numeros: numeros.slice(0, 8), sugestao: null };
  }

  const rej = t.match(/Rejei[cç][aã]o:?\s*(\d{3})/i);
  if (rej) {
    const motivo = t.slice(rej.index ?? 0).split("\n")[0].slice(0, 160);
    return { tipo: "rej", titulo: motivo, codigo: rej[1], sugestao: `rej ${rej[1]}` };
  }

  return null;
}

/** Junta a análise de todos os prints de uma demanda numa mensagem pro Mateus. */
export function mensagemSugestao(demandaId, analises) {
  const a = analises.find((x) => x?.sugestao) ?? analises.find((x) => x) ?? null;
  if (!a) {
    return {
      sugestao: null,
      texto: `Li os prints da demanda #${demandaId}, mas não reconheci o tipo do erro. Mande o atalho (ex.: trib 3575 3647) ou digite ajuda.`,
    };
  }
  if (a.tipo === "ibs") {
    const detalhes = [a.produtos.length ? `produto ${a.produtos.join(", ")}` : null, a.venda ? `venda ${a.venda}` : null].filter(Boolean).join(", ");
    if (!a.sugestao) {
      return { sugestao: null, texto: `Li na demanda #${demandaId}: ${a.titulo}. Não consegui ler o código do produto. Mande: ibs <produto> venda <número>.` };
    }
    return {
      sugestao: a.sugestao,
      texto: `Li na demanda #${demandaId}: ${a.titulo}${detalhes ? `, ${detalhes}` : ""}.\nSugestão: ${a.sugestao}\nResponda ok pra confirmar. Se a operação da venda for Outros, mande: ${a.sugestao} outros`,
    };
  }
  if (a.tipo === "trib") {
    // foto de tela troca dígitos dos códigos: não sugerimos números, só o formato
    return {
      sugestao: null,
      texto:
        `Li na demanda #${demandaId}: ${a.titulo}${a.cliente ? ` (cliente ${a.cliente})` : ""}.\n` +
        `Mande o atalho: trib <item com erro> <item que já entrou na nota>. Ex.: trib 3575 3647`,
    };
  }
  return { sugestao: a.sugestao, texto: `Li na demanda #${demandaId}: ${a.titulo}.\nSugestão: ${a.sugestao}\nResponda ok pra registrar.` };
}
