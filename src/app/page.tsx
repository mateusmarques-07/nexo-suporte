import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Casca } from "@/components/Casca";
import { Detalhe } from "@/components/Detalhe";
import { contarPendentes, lerSaude, NOME_STATUS, PRECISA, quando, type Demanda } from "@/lib/dados";
import { NOMES_TIPO } from "../../shared/atalhos.mjs";
import { respostaPadrao } from "../../shared/respostas.mjs";

export default async function Mesa({ searchParams }: { searchParams: Promise<{ d?: string; ver?: string }> }) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { d, ver } = await searchParams;

  const [{ data: lista }, saude, pendentes] = await Promise.all([
    supabase
      .from("demandas")
      .select("id, created_at, ultima_atividade, status, tipo, comando, params, resumo, sugestao, resposta, respondida_em, solicitante")
      .neq("status", ver === "arquivadas" ? "__nada__" : "arquivada")
      .order("ultima_atividade", { ascending: false })
      .limit(200),
    lerSaude(supabase),
    contarPendentes(supabase),
  ]);
  const demandas = (lista ?? []) as Demanda[];
  const precisa = demandas.filter((x) => PRECISA.includes(x.status));
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const respondidas = demandas.filter((x) => x.status === "respondida");
  const respondidasHoje = respondidas.filter((x) => x.respondida_em && new Date(x.respondida_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) === hoje);
  const outras = demandas.filter((x) => !PRECISA.includes(x.status) && x.status !== "respondida");

  const selId = Number(d) || precisa[0]?.id || demandas[0]?.id;
  const sel = demandas.find((x) => x.id === selId) ?? null;

  let detalhe = null;
  if (sel) {
    const [{ data: msgs }, { data: anexos }, { data: eventos }] = await Promise.all([
      supabase.from("mensagens").select("id, created_at, direcao, tipo, texto").eq("demanda_id", sel.id).order("created_at"),
      supabase.from("anexos").select("id, storage_path, mimetype, ocr_status, ocr_texto, ocr_dados").eq("demanda_id", sel.id).order("created_at"),
      supabase.from("eventos").select("created_at, tipo, detalhe").eq("demanda_id", sel.id).order("created_at", { ascending: false }).limit(15),
    ]);
    const caminhos = (anexos ?? []).map((a) => a.storage_path);
    const { data: assinadas } = caminhos.length
      ? await supabase.storage.from("anexos").createSignedUrls(caminhos, 3600)
      : { data: [] as { path: string | null; signedUrl: string }[] };
    detalhe = {
      demanda: sel,
      mensagens: msgs ?? [],
      anexos: (anexos ?? []).map((a) => ({ ...a, url: assinadas?.find((s) => s.path === a.storage_path)?.signedUrl ?? null })),
      eventos: eventos ?? [],
      respostaSugerida: sel.resposta ?? (sel.tipo ? respostaPadrao(sel.tipo, sel.params) : ""),
      quando: quando(sel.created_at),
    };
  }

  const item = (x: Demanda, curto = false) => (
    <Link key={x.id} className="item" href={`/?d=${x.id}${ver ? `&ver=${ver}` : ""}`} aria-current={x.id === selId ? "true" : undefined}>
      <div className="l1">
        <span className="t">
          #{x.id} · {x.tipo ? NOMES_TIPO[x.tipo as keyof typeof NOMES_TIPO] : "Novo pedido"}
        </span>
        {!curto && <span className={`pill st-${x.status}`}>{NOME_STATUS[x.status] ?? x.status}</span>}
        {curto && <span className="faint" style={{ fontSize: 12.5 }}>{quando(x.respondida_em ?? x.ultima_atividade)}</span>}
      </div>
      <span className="s">{x.resumo ?? x.sugestao ?? "Aguardando atalho ou leitura do print"}</span>
      {!curto && (
        <div className="l3">
          <span>{x.solicitante ?? "WhatsApp"}</span>
          <span>{quando(x.ultima_atividade)}</span>
        </div>
      )}
    </Link>
  );

  return (
    <Casca atual="mesa" pendentes={pendentes} saude={saude}>
      <div className="hello">
        <div>
          <h1 className="disp">Mesa de suporte</h1>
          <p>{precisa.length ? `${precisa.length} ${precisa.length === 1 ? "pedido precisa" : "pedidos precisam"} de você.` : "Nada esperando você."} Encaminhe pedidos pro WhatsApp 61 99400-8073.</p>
        </div>
        <div className="linha">
          <Link className="chip" href="/" aria-pressed={ver !== "arquivadas"}>Abertas</Link>
          <Link className="chip" href="/?ver=arquivadas" aria-pressed={ver === "arquivadas"}>Com arquivadas</Link>
        </div>
      </div>

      <div className="counts">
        <div className="count need"><b>{precisa.length}</b><span>precisam<br />de você</span></div>
        <div className="count auto"><b>{respondidasHoje.length}</b><span>respondidas<br />hoje</span></div>
        <div className="count"><b>{demandas.length}</b><span>demandas<br />na lista</span></div>
      </div>

      <div className="inbox">
        <div className="list">
          <div className="grp"><span>Precisa de você</span><span>{precisa.length}</span></div>
          {precisa.length ? precisa.map((x) => item(x)) : <div className="vazio">Nada esperando você.</div>}
          {outras.length > 0 && (
            <>
              <div className="grp"><span>Outras</span><span>{outras.length}</span></div>
              {outras.map((x) => item(x))}
            </>
          )}
          <div className="grp"><span>Respondidas</span><span>{respondidas.length}</span></div>
          {respondidas.length ? respondidas.slice(0, 30).map((x) => item(x, true)) : <div className="vazio">Nenhuma ainda.</div>}
        </div>
        {detalhe ? (
          <Detalhe {...detalhe} />
        ) : (
          <div className="det">
            <h2 className="disp">Nenhuma demanda ainda</h2>
            <p className="muted">
              Encaminhe um pedido pro WhatsApp do NEXO Suporte (61 99400-8073). Mande o print e, se souber, o atalho. Ex.: <span className="mono">trib 3575 3647</span>.
            </p>
          </div>
        )}
      </div>
    </Casca>
  );
}
