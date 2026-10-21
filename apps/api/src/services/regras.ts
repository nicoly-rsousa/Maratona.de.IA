import {
  versaoEfetiva,
  type CriterioParaRegra, type OSParaImpacto, type Fatos, type RegraResumo, type RespostaRegras, type VersaoPublicada, type VersaoRegrasResumo,
} from "@farol/shared";
import { db } from "../db.js";
import { lerAbertas } from "./os.js";

/** Versão de pontuação GLOBAL vigente: a base para conferir critérios e opções das regras (valem para todas as cidades). */
export const pontuacaoBase = (publicadas: VersaoPublicada[], agoraMs: number) => versaoEfetiva("", publicadas, agoraMs);

/** Versões vigentes PRÓPRIAS de cada cidade: ali uma regra pode não casar (alerta, nunca erro). */
export function versoesDeCidades(publicadas: VersaoPublicada[], agoraMs: number) {
  const cidades = [...new Set(publicadas.map((p) => p.cidadeId).filter((c): c is string => c != null))].sort();
  return cidades.flatMap((c) => {
    const v = versaoEfetiva(c, publicadas.filter((p) => p.cidadeId === c), agoraMs);
    return v ? [{ escopo: c, versao: v.versao }] : [];
  });
}

/** OS abertas no formato da previsão de impacto (todas as cidades: as regras valem para todas). */
export async function abertasParaImpacto(): Promise<OSParaImpacto[]> {
  const linhas = await lerAbertas("id, numero, cidade_id, tipo, fatos, aberta_em, prazo_limite, versao_pontuacao_id, numero_origem");
  return linhas.map((o) => ({
    id: o.id, numero: o.numero, cidade: o.cidade_id, tipo: o.tipo, fatos: (o.fatos ?? {}) as Fatos,
    abertaEmMs: Date.parse(o.aberta_em), prazoLimiteMs: o.prazo_limite ? Date.parse(o.prazo_limite) : null,
    prazoDesconhecido: o.numero_origem != null, versaoId: o.versao_pontuacao_id ?? null,
  }));
}

/** Estado completo da tela de precedência: regras em vigor, versão, lista de versões e critérios disponíveis. */
export async function montarRespostaRegras(editavel: boolean, publicadas: VersaoPublicada[]): Promise<RespostaRegras> {
  const [{ data: regrasDb, error: e1 }, { data: vers, error: e2 }] = await Promise.all([
    db.from("regras_precedencia").select("*").order("nivel", { ascending: false }).order("id"),
    db.from("regras_versoes").select("numero, justificativa, criado_em, criado_por, conteudo").order("numero", { ascending: false }).limit(200),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  if (!vers?.length) throw new Error("Nenhuma versão das regras de precedência: aplique a migration 0006.");

  const ids = [...new Set(vers.map((v) => v.criado_por as string | null).filter((x): x is string => !!x))];
  const { data: ps, error: e3 } = ids.length ? await db.from("perfis").select("user_id, nome").in("user_id", ids) : { data: [], error: null };
  if (e3) throw new Error(e3.message);
  const nomes = new Map((ps ?? []).map((p) => [p.user_id as string, p.nome as string]));

  const base = pontuacaoBase(publicadas, Date.now())?.versao ?? null;
  const nomeCriterio = new Map((base?.criterios ?? []).map((c) => [c.id, c.nome]));
  const regras: RegraResumo[] = (regrasDb ?? []).map((r) => ({
    id: r.id, nome: r.nome, ativa: r.ativa, nivel: r.nivel, prioridadeMinima: r.prioridade_minima, versao: r.versao, atualizadoEm: r.atualizado_em,
    condicoes: ((r.cond ?? []) as { criterio: string; opcoes: string[] }[]).map((c) => ({
      criterio: c.criterio, criterioNome: nomeCriterio.get(c.criterio) ?? c.criterio, opcoes: c.opcoes,
    })),
  }));
  const versoes: VersaoRegrasResumo[] = vers.map((v, i) => ({
    numero: v.numero, justificativa: v.justificativa, criadoEm: v.criado_em,
    autor: v.criado_por ? (nomes.get(v.criado_por as string) ?? null) : null,
    quantidade: Array.isArray(v.conteudo) ? v.conteudo.length : 0, vigente: i === 0,
  }));
  const criterios: CriterioParaRegra[] = (base?.criterios ?? []).map((c) => ({
    id: c.id, nome: c.nome, habilitado: c.habilitado, opcoes: c.opcoes.map((o) => o.label),
  }));
  return { regras, versao: versoes[0]!.numero, editavel, versoes, criterios, versaoPontuacao: base?.v ?? null };
}
