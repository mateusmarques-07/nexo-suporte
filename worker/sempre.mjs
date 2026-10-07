// Acesso ao Sempre (ERP da Winner, ScriptCase) com o usuário próprio do robô.
// Credenciais só no VPS: /root/.secrets/sempre_robo.env (SEMPRE_URL, SEMPRE_USER, SEMPRE_PASS).
import fs from "node:fs";
import { chromium } from "playwright";

const ARQ_ENV = process.env.SEMPRE_ENV || "/root/.secrets/sempre_robo.env";

export const sempreEnv = Object.fromEntries(
  fs.readFileSync(ARQ_ENV, "utf8").trim().split("\n").map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  })
);

export async function entrarNoSempre() {
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  await p.goto(sempreEnv.SEMPRE_URL, { waitUntil: "networkidle" });
  await p.fill("#user", sempreEnv.SEMPRE_USER);
  await p.fill("#pass", sempreEnv.SEMPRE_PASS);
  await Promise.all([p.waitForLoadState("networkidle"), p.click("#login-btn")]);
  await p.waitForTimeout(4000);
  return { navegador, ctx, p };
}
