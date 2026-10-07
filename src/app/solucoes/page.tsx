import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Casca } from "@/components/Casca";
import { contarPendentes, lerSaude } from "@/lib/dados";
import { mudarModo } from "@/lib/actions";

const MODOS = [
  ["auto", "Sozinho"],
  ["eu", "Eu respondo"],
  ["ok", "Pede meu ok"],
] as const;

export default async function Solucoes() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const [{ data: sols }, saude, pendentes] = await Promise.all([
    supabase.from("solucoes").select("chave, nome, descricao, modo, pronta").order("ordem"),
    lerSaude(supabase),
    contarPendentes(supabase),
  ]);

  return (
    <Casca atual="solucoes" pendentes={pendentes} saude={saude}>
      <div className="hello">
        <div>
          <h1 className="disp">Soluções</h1>
          <p>Cada tipo de pedido que o sistema sabe resolver. A correção automática de cada uma entra numa fase própria, testada antes.</p>
        </div>
      </div>
      <div className="sols">
        {(sols ?? []).map((s) => (
          <div className="sol" key={s.chave}>
            <div>
              <h4>{s.nome}</h4>
              <p>{s.descricao}</p>
              <span className={`pill ${s.pronta ? "st-respondida" : "st-arquivada"}`} style={{ marginTop: 6 }}>
                {s.pronta ? "Correção automática pronta" : "Correção automática em preparação"}
              </span>
            </div>
            {s.modo === "fixo" ? (
              <span className="pill st-erro">Sempre com você</span>
            ) : (
              <div className="linha">
                {MODOS.map(([m, rotulo]) => (
                  <form key={m} action={mudarModo.bind(null, s.chave, m)}>
                    <button className="chip" aria-pressed={s.modo === m} disabled={!s.pronta && m !== "ok"} title={!s.pronta && m !== "ok" ? "Libera depois que a correção automática estiver pronta" : undefined}>
                      {rotulo}
                    </button>
                  </form>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Casca>
  );
}
