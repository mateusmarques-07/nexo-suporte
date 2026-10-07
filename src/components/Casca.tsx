import Link from "next/link";
import { LogoNexo } from "./Logo";
import { sair } from "@/lib/actions";
import { Atualizar } from "./Atualizar";

type Saude = { uazapi: { ok: boolean; texto: string }; worker: { ok: boolean; texto: string } };

export function Casca({ atual, pendentes, saude, children }: { atual: "mesa" | "solucoes"; pendentes: number; saude: Saude; children: React.ReactNode }) {
  return (
    <div className="app">
      <aside className="side">
        <Link className="brand" href="/">
          <LogoNexo />
          <div>
            <div className="wm">
              NEXO <em>M</em>
            </div>
            <small>Suporte</small>
          </div>
        </Link>
        <nav aria-label="Menu">
          <Link href="/" aria-current={atual === "mesa" ? "page" : undefined}>
            <span>Mesa</span>
            {pendentes > 0 && <em>{pendentes}</em>}
          </Link>
          <Link href="/solucoes" aria-current={atual === "solucoes" ? "page" : undefined}>
            <span>Soluções</span>
          </Link>
        </nav>
        <div className="foot">
          <span>
            <span className={`dot${saude.uazapi.ok ? "" : " off"}`} />
            <b>WhatsApp</b> {saude.uazapi.texto}
          </span>
          <span>
            <span className={`dot${saude.worker.ok ? "" : " off"}`} />
            <b>Leitor de prints</b> {saude.worker.texto}
          </span>
          <form action={sair}>
            <button className="sair">Sair</button>
          </form>
        </div>
      </aside>
      <div className="main">
        {!saude.uazapi.ok && (
          <div className="alerta" role="alert">
            O WhatsApp do NEXO Suporte está desconectado ({saude.uazapi.texto}). Os pedidos encaminhados não estão chegando. Reconecte no painel da uazapi.
          </div>
        )}
        {children}
      </div>
      <Atualizar />
    </div>
  );
}
