// Atalhos de texto que o Mateus manda junto com o pedido no WhatsApp do NEXO Suporte.
// Usado pelo receptor do WhatsApp (Vercel) e pelo worker do VPS. Sem IA: regra fixa.

/**
 * Responsáveis técnicos permitidos por empresa (campo "Responsável técnico" do Sempre,
 * tela Empresa fat004). O CNPJ é trava: o robô só salva se a tela aberta for desse CNPJ.
 */
export const RTS = {
  "6024": {
    nome: "Águas Claras",
    cnpj: "05.421.585/0001-37",
    opcoes: [
      "Micaelli Martins Souza Marques - COREN/DF: 474.784",
      "Karoline Nogueira Martins - COREN/DF: 679.230",
    ],
  },
  "6148": {
    nome: "Winner 6148",
    cnpj: "05.421.585/0002-18",
    opcoes: [
      "Carliane Sousa Silva - COREN/DF: 618.783",
      "Vanessa Mourato Santos - COREN/DF: 643.339",
      "Jaqueline Emanueli Barros Teodoro - COREN/DF: 946.042",
    ],
  },
};

export const NOMES_TIPO = {
  rt: "Trocar RT",
  trib: "Duplicar tributação",
  ibs: "IBS/CBS",
  corte: "Produto de corte",
  rej: "Rejeição",
  canc: "Cancelar nota",
  outro: "Outro",
};

export const AJUDA = [
  "*NEXO Suporte*",
  "Pode escrever do seu jeito ou encaminhar a mensagem/print do time. Eu digo o que entendi e você responde *sim*.",
  "Se quiser ir mais rápido, os atalhos também funcionam:",
  "• rt 6148 vanessa  (troca o RT; empresas 6024 e 6148)",
  "• trib 3575 3647  (item com erro, item que já entrou na nota)",
  "• ibs 2609 venda 117327  (acrescente 'outros' se a operação for Outros)",
  "• corte 19  (cria o produto de corte a partir do código)",
  "• rej 778  (rejeição de nota)",
  "• cancelar 4512  (só registra; cancelamento tem trava)",
  "• sim  (aceita a sugestão que eu mandar)",
  "• nova  (o próximo envio abre outra demanda)",
].join("\n");

const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const numeros = (s) => (s.match(/\d[\d.]*/g) ?? []).map((n) => n.replace(/\./g, ""));

/**
 * Interpreta uma linha de texto. Retorna null quando não é um atalho
 * (aí o texto vira só observação da demanda).
 * @returns {null | {acao:'ajuda'|'ok'|'nova'} | {acao:'pedido', tipo:string, comando:string, params:object, resumo:string, erro?:string}}
 */
export function interpretar(textoOriginal) {
  if (!textoOriginal) return null;
  const t = semAcento(String(textoOriginal)).toLowerCase().trim().replace(/\s+/g, " ");
  if (!t) return null;
  if (["ajuda", "?", "atalhos", "help"].includes(t)) return { acao: "ajuda" };
  if (["ok", "sim", "confirmo", "pode"].includes(t)) return { acao: "ok" };
  if (["nova", "novo", "nova demanda"].includes(t)) return { acao: "nova" };

  const [cmd, ...resto] = t.split(" ");
  const args = resto.join(" ");

  if (cmd === "rt") {
    const empresa = numeros(args).find((n) => RTS[n]);
    const nome = args.replace(/\d[\d.]*/g, "").trim();
    if (!empresa) return pedidoErro("rt", t, "Diga a empresa: 6024 ou 6148. Ex.: rt 6148 vanessa");
    const opcoes = RTS[empresa].opcoes;
    const achados = nome ? opcoes.filter((o) => semAcento(o).toLowerCase().includes(nome)) : [];
    if (achados.length !== 1) {
      const lista = opcoes.map((o) => o.split(" ")[0]).join(", ");
      return pedidoErro("rt", t, `Não reconheci o nome. Na ${empresa} as opções são: ${lista}.`);
    }
    return {
      acao: "pedido",
      tipo: "rt",
      comando: `rt ${empresa} ${achados[0].split(" ")[0].toLowerCase()}`,
      params: { empresa, rt: achados[0] },
      resumo: `Trocar o RT da ${empresa} para ${achados[0]}`,
    };
  }

  if (["trib", "tributacao", "dup", "duplicar"].includes(cmd)) {
    const ns = numeros(args);
    if (ns.length < 2) return pedidoErro("trib", t, "Mande o item com erro e o item que já entrou na nota. Ex.: trib 3575 3647");
    const principal = ns[ns.length - 1];
    const itens = ns.slice(0, -1);
    return {
      acao: "pedido",
      tipo: "trib",
      comando: `trib ${itens.join(",")} ${principal}`,
      params: { itens, principal },
      resumo: `Duplicar tributação: ${itens.length > 1 ? "itens" : "item"} ${itens.join(", ")} recebe${itens.length > 1 ? "m" : ""} a tributação do ${principal}`,
    };
  }

  if (cmd === "ibs" || cmd === "cbs") {
    const outros = /\boutros?\b/.test(args);
    const mVenda = args.match(/venda\s*(\d[\d.]*)/);
    const venda = mVenda ? mVenda[1].replace(/\./g, "") : null;
    const produtos = numeros(args.replace(/venda\s*\d[\d.]*/, ""));
    if (!produtos.length) return pedidoErro("ibs", t, "Mande o código do produto. Ex.: ibs 2609 venda 117327");
    const op = outros ? "outros" : "venda";
    return {
      acao: "pedido",
      tipo: "ibs",
      comando: `ibs ${produtos.join(",")}${venda ? ` venda ${venda}` : ""}${outros ? " outros" : ""}`,
      params: { produtos, venda, operacao: op },
      resumo: `Configurar IBS/CBS do${produtos.length > 1 ? "s produtos" : " produto"} ${produtos.join(", ")} (CST ${op === "venda" ? "000" : "410"}, todas as empresas, operação ${op === "venda" ? "Venda" : "Outros"})${venda ? ` e excluir o faturamento da venda ${venda}` : ""}`,
    };
  }

  if (cmd === "corte") {
    const ns = numeros(args);
    if (!ns.length) return pedidoErro("corte", t, "Mande o código de origem. Ex.: corte 19");
    return {
      acao: "pedido",
      tipo: "corte",
      comando: `corte ${ns[0]}`,
      params: { origem: ns[0] },
      resumo: `Criar o produto de corte a partir do código ${ns[0]}`,
    };
  }

  if (["rej", "rejeicao"].includes(cmd)) {
    const ns = numeros(args);
    return {
      acao: "pedido",
      tipo: "rej",
      comando: `rej${ns[0] ? " " + ns[0] : ""}`,
      params: { codigo: ns[0] ?? null },
      resumo: ns[0] ? `Rejeição ${ns[0]}` : "Rejeição de nota",
    };
  }

  if (["cancelar", "canc", "cancela"].includes(cmd)) {
    const ns = numeros(args);
    if (!ns.length) return pedidoErro("canc", t, "Mande o número da nota. Ex.: cancelar 4512");
    return {
      acao: "pedido",
      tipo: "canc",
      comando: `cancelar ${ns[0]}`,
      params: { nota: ns[0] },
      resumo: `Cancelar a NF-e ${ns[0]} (só com confirmação na mesa)`,
    };
  }

  return null;
}

function pedidoErro(tipo, comando, erro) {
  return { acao: "pedido", tipo, comando, params: {}, resumo: "", erro };
}

/** Número do Mateus pode chegar com ou sem o 9 extra; compara DDD + 8 últimos dígitos. */
export function mesmoNumero(a, b) {
  const norm = (n) => {
    let d = String(n ?? "").split("@")[0].replace(/\D/g, "");
    if (d.startsWith("55")) d = d.slice(2);
    return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : d;
  };
  return !!a && !!b && norm(a) === norm(b);
}
