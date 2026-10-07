"use client";

import { useState, useTransition } from "react";
import { aplicarAtalho, definirSolicitante, marcarRespondida, mudarStatus } from "@/lib/actions";
import { NOME_STATUS, type Demanda } from "@/lib/dados";

type Msg = { id: string; created_at: string; direcao: string; tipo: string; texto: string | null };
type Anexo = { id: string; storage_path: string; mimetype: string | null; ocr_status: string; ocr_texto: string | null; url: string | null };
type Evento = { created_at: string; tipo: string; detalhe: Record<string, unknown> };

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

export function Detalhe({
  demanda: d,
  mensagens,
  anexos,
  respostaSugerida,
  quando,
}: {
  demanda: Demanda;
  mensagens: Msg[];
  anexos: Anexo[];
  eventos: Evento[];
  respostaSugerida: string;
  quando: string;
}) {
  const [atalho, setAtalho] = useState(d.comando ?? d.sugestao ?? "");
  const [resposta, setResposta] = useState(respostaSugerida);
  const [solic, setSolic] = useState(d.solicitante ?? "");
  const [aviso, setAviso] = useState("");
  const [pendente, iniciar] = useTransition();

  const rodar = (fn: () => Promise<{ erro?: string } | void>, ok: string) =>
    iniciar(async () => {
      const r = await fn();
      setAviso(r && "erro" in r && r.erro ? r.erro : ok);
    });

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(resposta);
      setAviso("Resposta copiada. É só colar no WhatsApp do time.");
    } catch {
      setAviso("Não consegui copiar. Selecione o texto e use Ctrl+C.");
    }
  };

  const textosEntrada = mensagens.filter((m) => m.direcao === "entrada" && m.texto);
  const ocrs = anexos.filter((a) => a.ocr_texto);
  const respondida = d.status === "respondida";

  return (
    <div className="det" key={d.id}>
      <div className="det-head">
        <div className="meta">
          <span className={`pill st-${d.status}`}>{NOME_STATUS[d.status] ?? d.status}</span>
          <span className="mono">#{d.id}</span>
          <span>aberta {quando}</span>
        </div>
        <h2 className="disp">{d.resumo ?? "Pedido recebido"}</h2>
        <div className="linha">
          <label className="nota" htmlFor={`solic-${d.id}`}>Quem pediu:</label>
          <input
            id={`solic-${d.id}`}
            className="campo"
            style={{ width: 200 }}
            placeholder="ex.: Faturamento"
            value={solic}
            onChange={(e) => setSolic(e.target.value)}
            onBlur={() => solic !== (d.solicitante ?? "") && iniciar(() => definirSolicitante(d.id, solic))}
          />
        </div>
      </div>

      {d.sugestao && !d.comando && (
        <div className="sug">
          <span>
            Li no print e sugiro: <b className="mono">{d.sugestao}</b>
          </span>
          <button className="btn" disabled={pendente} onClick={() => rodar(() => aplicarAtalho(d.id, d.sugestao!), "Sugestão aplicada.")}>
            Usar sugestão
          </button>
        </div>
      )}

      <div className="blk plan">
        <h3 className="rot">O que fazer</h3>
        <div className="linha">
          <input
            id={`atalho-${d.id}`}
            className="campo mono"
            style={{ flex: "1 1 220px" }}
            placeholder="atalho, ex.: trib 3575 3647"
            value={atalho}
            onChange={(e) => setAtalho(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && rodar(() => aplicarAtalho(d.id, atalho), "Atalho aplicado.")}
          />
          <button className="btn" disabled={pendente || !atalho.trim()} onClick={() => rodar(() => aplicarAtalho(d.id, atalho), "Atalho aplicado.")}>
            Aplicar atalho
          </button>
        </div>
        <p className="nota" style={{ margin: 0 }}>
          {d.comando
            ? "A correção automática no Sempre entra nas próximas fases. Por enquanto: faça a correção no Sempre e depois envie a resposta abaixo."
            : "Ainda sem atalho. Use o do print, digite um aqui ou mande pelo WhatsApp."}
        </p>
      </div>

      <div className="blk">
        <h3 className="rot">O que chegou</h3>
        {anexos.length > 0 && (
          <div className="prints">
            {anexos.map((a) =>
              a.url ? (
                <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
                  {a.mimetype?.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt="Print enviado" />
                  ) : (
                    <div className="pdf">Abrir arquivo</div>
                  )}
                </a>
              ) : null
            )}
          </div>
        )}
        {textosEntrada.length > 0 && (
          <div className="conversa">
            {textosEntrada.map((m) => (
              <div key={m.id} className="bolha">
                <small>{hora(m.created_at)}</small>
                {m.texto}
              </div>
            ))}
          </div>
        )}
        {!anexos.length && !textosEntrada.length && <p className="nota">Só mensagens sem texto ou print.</p>}
        {ocrs.length > 0 && (
          <details className="ocr">
            <summary>Texto lido dos prints</summary>
            {ocrs.map((a) => (
              <pre key={a.id}>{a.ocr_texto}</pre>
            ))}
          </details>
        )}
      </div>

      <div className="resp">
        <h3 className="rot">Resposta pro time</h3>
        <textarea id={`resp-${d.id}`} value={resposta} onChange={(e) => setResposta(e.target.value)} placeholder="Escreva a resposta que vai mandar ao time" />
        <div className="linha">
          <button className="btn" onClick={copiar} disabled={!resposta.trim()}>
            Copiar
          </button>
          {!respondida ? (
            <button className="btn pri" disabled={pendente || !resposta.trim()} onClick={() => rodar(() => marcarRespondida(d.id, resposta), "Marcada como respondida.")}>
              Marcar como respondida
            </button>
          ) : (
            <span className="nota">Respondida{d.respondida_em ? ` às ${hora(d.respondida_em)}` : ""}.</span>
          )}
          {d.status !== "arquivada" ? (
            <button className="btn" disabled={pendente} onClick={() => rodar(() => mudarStatus(d.id, "arquivada"), "Arquivada.")}>
              Arquivar
            </button>
          ) : (
            <button className="btn" disabled={pendente} onClick={() => rodar(() => mudarStatus(d.id, d.comando ? "entendida" : "recebida"), "Reaberta.")}>
              Reabrir
            </button>
          )}
        </div>
        {aviso && <p className="nota" role="status" style={{ margin: 0 }}>{aviso}</p>}
      </div>
    </div>
  );
}
