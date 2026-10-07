import { createClient } from "@/lib/supabase/server";

export type Demanda = {
  id: number;
  created_at: string;
  ultima_atividade: string;
  status: string;
  tipo: string | null;
  comando: string | null;
  params: Record<string, unknown>;
  resumo: string | null;
  sugestao: string | null;
  resposta: string | null;
  respondida_em: string | null;
  solicitante: string | null;
};

export const PRECISA = ["recebida", "entendida", "aguardando_ok", "corrigida", "erro"];

export const NOME_STATUS: Record<string, string> = {
  recebida: "Recebida",
  entendida: "Entendida",
  aguardando_ok: "Aguardando seu ok",
  corrigindo: "Corrigindo",
  corrigida: "Falta responder",
  respondida: "Respondida",
  arquivada: "Arquivada",
  erro: "Erro",
};

type Supa = Awaited<ReturnType<typeof createClient>>;

export async function lerSaude(supabase: Supa) {
  const { data } = await supabase.from("saude").select("chave, status, verificado_em");
  const agora = Date.now();
  const linha = (c: string) => data?.find((d) => d.chave === c);
  const u = linha("uazapi");
  const w = linha("worker");
  const minutos = (iso?: string) => (iso ? (agora - new Date(iso).getTime()) / 60000 : Infinity);
  const uazapiOk = !!u && ["connected", "open"].includes(u.status) && minutos(u.verificado_em) < 20;
  const workerOk = !!w && minutos(w.verificado_em) < 5;
  return {
    uazapi: { ok: uazapiOk || !u, texto: !u ? "aguardando 1ª verificação" : uazapiOk ? "conectado" : u.status === "connected" ? "sem verificação recente" : "desconectado" },
    worker: { ok: workerOk, texto: workerOk ? "ligado" : "parado" },
  };
}

export async function contarPendentes(supabase: Supa) {
  const { count } = await supabase.from("demandas").select("id", { count: "exact", head: true }).in("status", PRECISA);
  return count ?? 0;
}

export function quando(iso: string) {
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const dia = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  return dia === hoje ? hora : `${dia.slice(0, 5)} ${hora}`;
}
