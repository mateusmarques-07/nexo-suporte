"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { interpretar } from "../../shared/atalhos.mjs";

export async function entrar(_: { erro: string }, form: FormData): Promise<{ erro: string }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get("email") ?? "").trim().toLowerCase(),
    password: String(form.get("senha") ?? ""),
  });
  if (error) return { erro: "E-mail ou senha inválidos." };
  redirect("/");
}

export async function sair() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

async function logado() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return supabase;
}

async function registrar(supabase: Awaited<ReturnType<typeof createClient>>, demandaId: number, tipo: string, detalhe: object) {
  await supabase.from("eventos").insert({ demanda_id: demandaId, tipo, detalhe });
}

/** Aplica um atalho digitado na mesa (mesmo formato do WhatsApp). */
export async function aplicarAtalho(demandaId: number, texto: string): Promise<{ erro?: string }> {
  const supabase = await logado();
  const a = interpretar(texto);
  if (!a || a.acao !== "pedido") return { erro: "Não reconheci o atalho. Ex.: trib 3575 3647" };
  if (a.erro) return { erro: a.erro };
  const { error } = await supabase
    .from("demandas")
    .update({ tipo: a.tipo, comando: a.comando, params: a.params, resumo: a.resumo, status: "entendida", updated_at: new Date().toISOString() })
    .eq("id", demandaId);
  if (error) return { erro: error.message };
  await registrar(supabase, demandaId, "atalho_mesa", { comando: a.comando });
  // solução que já corrige sozinha: entra na fila do worker do VPS
  const { data: sol } = await supabase.from("solucoes").select("pronta").eq("chave", a.tipo).maybeSingle();
  if (sol?.pronta) await supabase.from("demandas").update({ correcao_pedida_em: new Date().toISOString() }).eq("id", demandaId);
  revalidatePath("/");
  return {};
}

/** Marca como respondida guardando o texto que o Mateus mandou ao time. */
export async function marcarRespondida(demandaId: number, resposta: string): Promise<{ erro?: string }> {
  const supabase = await logado();
  const { error } = await supabase
    .from("demandas")
    .update({ status: "respondida", resposta, respondida_em: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", demandaId);
  if (error) return { erro: error.message };
  await registrar(supabase, demandaId, "respondida", { resposta });
  revalidatePath("/");
  return {};
}

export async function mudarStatus(demandaId: number, status: "arquivada" | "recebida" | "entendida"): Promise<{ erro?: string }> {
  const supabase = await logado();
  const { error } = await supabase.from("demandas").update({ status, updated_at: new Date().toISOString() }).eq("id", demandaId);
  if (error) return { erro: error.message };
  await registrar(supabase, demandaId, "status", { status });
  revalidatePath("/");
  return {};
}

export async function definirSolicitante(demandaId: number, solicitante: string): Promise<void> {
  const supabase = await logado();
  await supabase.from("demandas").update({ solicitante: solicitante.trim() || null }).eq("id", demandaId);
  revalidatePath("/");
}

export async function mudarModo(chave: string, modo: "auto" | "eu" | "ok"): Promise<void> {
  const supabase = await logado();
  await supabase.from("solucoes").update({ modo }).eq("chave", chave).neq("modo", "fixo");
  revalidatePath("/solucoes");
}
