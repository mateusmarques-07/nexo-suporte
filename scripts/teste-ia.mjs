// Testa a IA (worker/ia.mjs) com textos e prints de exemplo, passando pelas travas do interpretar().
// Não mexe em banco nem no Sempre. Uso: node scripts/teste-ia.mjs   (de qualquer pasta)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { interpretar } from "../shared/atalhos.mjs";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const linha of fs.readFileSync(path.join(raiz, ".env.local"), "utf8").split("\n")) {
  const i = linha.indexOf("=");
  if (i > 0 && !process.env[linha.slice(0, i)]) process.env[linha.slice(0, i)] = linha.slice(i + 1);
}
// opcional: node scripts/teste-ia.mjs <modelo> <trecho do nome do caso>
if (process.argv[2]) process.env.OPENAI_MODELO = process.argv[2];
const filtro = process.argv[3] ?? "";
const { entenderPedido, prepararImagem } = await import("../worker/ia.mjs");
const EXEMPLOS = path.join(raiz, "..", "exemplos");

async function imagem(nome) {
  const copia = path.join(os.tmpdir(), `teste-ia-${nome}`);
  fs.copyFileSync(path.join(EXEMPLOS, nome), copia);
  const saida = await prepararImagem(copia);
  const base64 = fs.readFileSync(saida).toString("base64");
  fs.rmSync(saida);
  fs.rmSync(copia);
  return { base64, mime: "image/jpeg" };
}
const m = (texto) => ({ papel: "mateus", texto });
const s = (texto) => ({ papel: "sistema", texto });

// esperado: função que recebe o comando normalizado (ou null) e a pergunta, e diz se passou
const CASOS = [
  ["texto informal RT Águas Claras", [m("oi, troca o rt da aguas claras pra karol por favor")], [], (c) => c === "rt 6024 karoline"],
  ["mensagem encaminhada do time (DF140)", [m("Mateus, pode colocar a Vanessa como responsável técnica na DF140? preciso imprimir etiqueta")], [], (c) => c === "rt 6148 vanessa"],
  ["RT sem empresa (Jaqueline só existe na 6148)", [m("troca o rt pra jaqueline")], [], (c, p) => c === "rt 6148 jaqueline" || (!c && !!p)],
  ["RT com nome que não existe na empresa", [m("troca o rt da 6024 pra vanessa")], [], (c, p) => !c && !!p],
  ["produto de corte", [m("crie um produto de corte do cód 19")], [], (c) => c === "corte 19"],
  ["não é pedido", [m("obrigado!")], [], (c, p) => !c && !p],
  ["print rejeição IBS/CBS", [m("deu esse erro aqui")], ["rejeicao-ibs-cbs-01.png"], (c) => c === "ibs 2609 venda 117327"],
  ["2 prints tributação", [], ["dup-trib-01-erro-item.png", "dup-trib-02-itens-ja-inseridos.png"], (c) => /^trib 3575 (3647|564|2621)$/.test(c ?? "")],
  ["cancelar nota", [m("a nota 4512 precisa cancelar")], [], (c) => c === "cancelar 4512"],
  ["correção no meio da conversa", [m("troca o rt da aguas claras pra karol"), s("Entendi #7: Trocar o RT da 6024 para Karoline Nogueira Martins - COREN/DF: 679.230.\nPosso fazer? Responda sim."), m("não, é a micaelli")], [], (c) => c === "rt 6024 micaelli"],
  ["rejeição com código", [m("deu rejeição 778 na nota do hospital")], [], (c) => c === "rej 778"],
];

let ok = 0;
const usos = [];
for (const [nome, conversa, prints, esperado] of CASOS.filter(([n]) => n.includes(filtro))) {
  try {
    const r = await entenderPedido({ conversa, imagens: await Promise.all(prints.map(imagem)) });
    const a = r.atalho ? interpretar(r.atalho) : null;
    const comando = a?.acao === "pedido" && !a.erro ? a.comando : null;
    const passou = esperado(comando, r.pergunta ?? a?.erro);
    if (passou) ok++;
    usos.push({ nome, ...r.uso, prints: prints.length });
    console.log(`${passou ? "✅" : "❌"} ${nome}\n   IA: ${r.atalho ?? "(sem atalho)"} → travas: ${comando ?? a?.erro ?? "-"}\n   explicação: ${r.explicacao}${r.pergunta ? `\n   pergunta: ${r.pergunta}` : ""}\n   tokens: ${r.uso.prompt_tokens} entrada / ${r.uso.completion_tokens} saída`);
  } catch (err) {
    console.log(`❌ ${nome}: ${err.message}`);
  }
}
console.log(`\nRESUMO: ${ok}/${usos.length} ok`);
const soma = (k, f) => usos.filter(f).reduce((t, u) => t + (u[k] ?? 0), 0);
console.log("tokens só texto:", soma("prompt_tokens", (u) => !u.prints), "entrada /", soma("completion_tokens", (u) => !u.prints), "saída em", usos.filter((u) => !u.prints).length, "casos");
console.log("tokens com print:", soma("prompt_tokens", (u) => u.prints), "entrada /", soma("completion_tokens", (u) => u.prints), "saída em", usos.filter((u) => u.prints).length, "casos");
