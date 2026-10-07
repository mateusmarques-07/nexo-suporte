// Texto pronto pro Mateus mandar ao time quando a demanda estiver resolvida.
// Ele pode editar na mesa antes de copiar/enviar.

export function respostaPadrao(tipo, params = {}) {
  switch (tipo) {
    case "rt":
      return params.rt
        ? `Pronto, o RT da ${params.empresa} agora é ${String(params.rt).split(" - ")[0]}. Já pode imprimir as etiquetas.`
        : "Pronto, troquei o RT. Já pode imprimir as etiquetas.";
    case "trib":
      return `Pronto, corrigi a tributação do item ${(params.itens ?? []).join(", ")}. Pode inserir de novo na venda.`;
    case "ibs":
      return params.venda
        ? `Pronto, configurei o IBS/CBS do produto ${(params.produtos ?? []).join(", ")} e excluí o faturamento da venda ${params.venda}. Agora é só ir em Ferramentas, recalcular a venda e emitir de novo.`
        : `Pronto, configurei o IBS/CBS do produto ${(params.produtos ?? []).join(", ")}. Pode emitir de novo.`;
    case "corte":
      return `Pronto, criei o produto de corte a partir do código ${params.origem}.`;
    case "canc":
      return `Pronto, a nota ${params.nota} foi cancelada.`;
    case "rej":
      return "Pronto, corrigi. Pode reenviar a nota.";
    default:
      return "Pronto, resolvido. Pode tentar de novo.";
  }
}
