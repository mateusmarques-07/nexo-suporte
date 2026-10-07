// Solução "Trocar RT": troca o Responsável técnico de uma empresa no Sempre.
// Tela: Consulta Empresa (fat004_1) › lápis › Atualização Empresa (fat004_2),
// campo tx_responsavel_tecnico (texto livre), botão Salvar #sc_b_upd_t.
//
// Travas: só empresas e nomes da lista RTS; confere o CNPJ da tela antes de mexer;
// só mexe nesse campo; depois de salvar reabre a tela e confere o valor gravado.
//
// Uso (o worker chama assim; também dá pra rodar à mão):
//   node worker/solucoes/rt.mjs 6148 "Vanessa Mourato Santos - COREN/DF: 643.339" <pasta-prints> [--simular]
// --simular faz tudo menos preencher e salvar.
// Última linha da saída = JSON com o resultado.
import fs from "node:fs";
import path from "node:path";
import { RTS } from "../../shared/atalhos.mjs";
import { entrarNoSempre, sempreEnv } from "../sempre.mjs";

const [empresa, rtNovo, pasta = "/tmp", flag] = process.argv.slice(2);
const simular = flag === "--simular";
const fim = (r) => {
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
};

const cfg = RTS[empresa];
if (!cfg) fim({ ok: false, erro: `Empresa ${empresa} não está na lista de RT.` });
if (!cfg.opcoes.includes(rtNovo)) fim({ ok: false, erro: `"${rtNovo}" não é RT permitido na ${empresa}.` });
fs.mkdirSync(pasta, { recursive: true });

const codF = empresa.replace(/(\d+)(\d{3})$/, "$1.$2");

/** Abre a Atualização Empresa da empresa pedida e devolve a página do formulário. */
async function abrirEmpresa(p) {
  await p.goto(sempreEnv.SEMPRE_URL + "/fat004_1", { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  // o lápis (#bedit, mesmo id em todas as linhas) fica numa tabelinha dentro da linha: sobe até a <tr> com o código
  const idx = await p.$$eval(
    "#bedit",
    (as, codF) =>
      as.findIndex((a) => {
        for (let tr = a.closest("tr"); tr; tr = tr.parentElement.closest("tr"))
          if (tr.innerText.includes(codF)) return tr.querySelectorAll("#bedit").length === 1;
        return false;
      }),
    codF
  );
  if (idx < 0) throw new Error(`Empresa ${codF} não apareceu na Consulta Empresa.`);
  await Promise.all([p.waitForURL(/fat004_2/, { timeout: 60000 }), p.locator("#bedit").nth(idx).click()]);
  await p.waitForLoadState("networkidle").catch(() => {});
  await p.locator('input[name="tx_responsavel_tecnico"]').waitFor({ timeout: 60000 });
  await p.waitForTimeout(1500);
  const cnpj = await p.inputValue('input[name="cnpj"]');
  if (cnpj.trim() !== cfg.cnpj) throw new Error(`A tela aberta é do CNPJ ${cnpj}, esperado ${cfg.cnpj}. Não mexi em nada.`);
  return p;
}

const lerRt = async (p) => (await p.inputValue('input[name="tx_responsavel_tecnico"]')).trim();

const { navegador, p } = await entrarNoSempre();
const dialogos = [];
// qualquer janelinha de confirmação/erro do Sempre é recusada e registrada (nada é aceito às cegas)
p.on("dialog", async (d) => {
  dialogos.push(d.message());
  await d.dismiss().catch(() => {});
});

async function executar() {
  await abrirEmpresa(p);
  const antes = await lerRt(p);
  const printAntes = path.join(pasta, `rt-${empresa}-antes.png`);
  await p.screenshot({ path: printAntes });

  if (antes === rtNovo) return { ok: true, mudou: false, empresa, antes, depois: antes, prints: [printAntes] };
  if (simular) return { ok: true, simulado: true, empresa, antes, pretendido: rtNovo, prints: [printAntes] };

  await p.fill('input[name="tx_responsavel_tecnico"]', rtNovo);
  await p.click("#sc_b_upd_t");
  await p.waitForLoadState("networkidle").catch(() => {});
  await p.waitForTimeout(5000);
  const avisoTela = await p
    .locator(".scFormErrorMessage, #id_message_display, .scErrorMessage")
    .allInnerTexts()
    .then((t) => t.join(" ").replace(/\s+/g, " ").trim())
    .catch(() => "");

  // conferência: reabre do zero e lê o que ficou gravado
  await abrirEmpresa(p);
  const depois = await lerRt(p);
  const printDepois = path.join(pasta, `rt-${empresa}-depois.png`);
  await p.screenshot({ path: printDepois });

  const base = { empresa, antes, depois, dialogos, avisoTela, prints: [printAntes, printDepois] };
  if (depois !== rtNovo) return { ok: false, erro: `Salvei, mas ao conferir o RT está "${depois}".`, ...base };
  return { ok: true, mudou: true, ...base };
}

let resultado;
try {
  resultado = await executar();
} catch (err) {
  const printErro = path.join(pasta, `rt-${empresa}-erro.png`);
  await p.screenshot({ path: printErro }).catch(() => {});
  resultado = { ok: false, erro: String(err?.message ?? err).slice(0, 400), dialogos, prints: [printErro] };
}
await navegador.close().catch(() => {});
fim(resultado);
