"use client";

import { useActionState } from "react";
import { entrar } from "@/lib/actions";
import { LogoNexo } from "@/components/Logo";

export default function Login() {
  const [estado, acao, pendente] = useActionState(entrar, { erro: "" });
  return (
    <div className="login">
      <form action={acao}>
        <div className="brand" style={{ color: "var(--fg)" }}>
          <LogoNexo />
          <div>
            <div className="wm" style={{ color: "var(--fg)" }}>
              NEXO <em>M</em> Suporte
            </div>
            <small style={{ color: "var(--muted)" }}>NEXO MARQUES</small>
          </div>
        </div>
        <label>
          E-mail
          <input id="email" name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Senha
          <input id="senha" name="senha" type="password" autoComplete="current-password" required />
        </label>
        {estado.erro && <p className="erro">{estado.erro}</p>}
        <button className="btn pri big" disabled={pendente}>
          {pendente ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
