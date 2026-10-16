import {
  RegraSchema, VersaoPontuacaoSchema, versaoEfetiva,
  type ModoPublicacao, type Regra, type VersaoPontuacao, type VersaoPublicada,
} from "@farol/shared";
import { db } from "./db.js";

/** Todas as versões publicadas (poucas linhas). O escopo e a vigência são decididos em @farol/shared. */
export async function carregarPublicadas(): Promise<VersaoPublicada[]> {
  const { data, error } = await db
    .from("versoes_pontuacao")
    .select("id, cidade_id, numero, conteudo, vigencia_inicio, modo_publicacao")
    .eq("status", "publicada");
  if (error) throw new Error(`Erro ao ler as versões de pontuação: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    cidadeId: (r.cidade_id as string | null) ?? null,
    numero: r.numero as number,
    vigenciaInicioMs: Date.parse(r.vigencia_inicio as string),
    modo: r.modo_publicacao as ModoPublicacao,
    versao: VersaoPontuacaoSchema.parse({ ...(r.conteudo as object), v: r.numero }),
  }));
}

/** Versão publicada e vigente para OS NOVAS: a da cidade prevalece sobre a global (§5). */
export async function versaoVigente(cidade: string): Promise<{ id: string; versao: VersaoPontuacao }> {
  const v = versaoEfetiva(cidade, await carregarPublicadas(), Date.now());
  if (!v) throw new Error("Nenhuma versão de pontuação publicada.");
  return { id: v.id, versao: v.versao };
}

export async function regrasAtivas(): Promise<Regra[]> {
  const { data, error } = await db.from("regras_precedencia").select("*").eq("ativa", true);
  if (error) throw error;
  return (data ?? []).map((r) =>
    RegraSchema.parse({ id: r.id, nome: r.nome, ativa: r.ativa, cond: r.cond, nivel: r.nivel, prioridadeMinima: r.prioridade_minima }),
  );
}

export interface RegrasEmVigor {
  /** número da versão do conjunto (regras_versoes) */
  numero: number;
  justificativa: string;
  regras: Regra[];
}

/**
 * Regras ativas + a versão do conjunto em vigor. A versão é lida ANTES das regras: se uma gravação cair entre as duas
 * leituras, a OS fica carimbada com a versão antiga e a rotina a recalcula na volta seguinte (nunca o contrário).
 */
export async function regrasEmVigor(): Promise<RegrasEmVigor> {
  const { data, error } = await db.from("regras_versoes").select("numero, justificativa").order("numero", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Erro ao ler a versão das regras: ${error.message}`);
  if (!data) throw new Error("Nenhuma versão das regras de precedência: aplique a migration 0006.");
  return { numero: data.numero as number, justificativa: data.justificativa as string, regras: await regrasAtivas() };
}

export interface ConfigPontuacao {
  maxPontos: number;
  exigirAprovacao: boolean;
}

/** Limites da pontuação, lidos da tabela `configuracoes` (nunca fixos no código). */
export async function configPontuacao(): Promise<ConfigPontuacao> {
  const { data, error } = await db.from("configuracoes").select("chave, valor").in("chave", ["pontuacao.max_pontos", "pontuacao.exigir_aprovacao"]);
  if (error) throw new Error(`Erro ao ler as configurações: ${error.message}`);
  const v = new Map((data ?? []).map((r) => [r.chave as string, r.valor as unknown]));
  const max = v.get("pontuacao.max_pontos");
  const exigir = v.get("pontuacao.exigir_aprovacao");
  if (typeof max !== "number" || !Number.isInteger(max) || max < 1) throw new Error('Configuração "pontuacao.max_pontos" ausente ou inválida.');
  if (typeof exigir !== "boolean") throw new Error('Configuração "pontuacao.exigir_aprovacao" ausente ou inválida.');
  return { maxPontos: max, exigirAprovacao: exigir };
}
