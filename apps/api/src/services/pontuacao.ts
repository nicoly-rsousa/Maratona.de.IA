import {
  ConteudoSchema, ESCOPO_GLOBAL, versaoEfetiva,
  type EstadoPontuacao, type VersaoComConteudo, type VersaoResumo,
} from "@farol/shared";
import { carregarPublicadas, configPontuacao } from "../config.js";
import { db, type Linha } from "../db.js";


/** Cidade do escopo: null = global. */
export const cidadeDoEscopo = (escopo: string): string | null => (escopo === ESCOPO_GLOBAL ? null : escopo);
export const escopoDaLinha = (l: Linha): string => (l.cidade_id as string | null) ?? ESCOPO_GLOBAL;

export async function escopoExiste(escopo: string): Promise<boolean> {
  if (escopo === ESCOPO_GLOBAL) return true;
  const { data, error } = await db.from("cidades").select("id").eq("id", escopo).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

/** Estado de um escopo: publicada vigente, rascunho, aguardando aprovação e histórico (§5). */
export async function montarEstado(escopo: string): Promise<EstadoPontuacao> {
  const cidade = cidadeDoEscopo(escopo);
  const consulta = db.from("versoes_pontuacao").select("*").order("numero", { ascending: false });
  const [{ data, error }, cfg, publicadas] = await Promise.all([
    cidade ? consulta.eq("cidade_id", cidade) : consulta.is("cidade_id", null),
    configPontuacao(),
    carregarPublicadas(),
  ]);
  if (error) throw new Error(`Erro ao ler as versões: ${error.message}`);
  const linhas = (data ?? []) as Linha[];
  const agora = Date.now();

  // vigente NO PRÓPRIO escopo (a global não conta para uma cidade)
  const vigenteId = versaoEfetiva(cidade ?? "", publicadas.filter((p) => p.cidadeId === cidade), agora)?.id;

  const ids = [...new Set(linhas.flatMap((l) => [l.autor_publicacao, l.aprovado_por, l.atualizado_por]).filter((x): x is string => !!x))];
  const { data: ps, error: e2 } = ids.length ? await db.from("perfis").select("user_id, nome").in("user_id", ids) : { data: [], error: null };
  if (e2) throw new Error(e2.message);
  const nomes = new Map((ps ?? []).map((p) => [p.user_id as string, p.nome as string]));
  const nome = (id: string | null) => (id ? (nomes.get(id) ?? null) : null);

  const resumo = (l: Linha): VersaoResumo => ({
    id: l.id, numero: l.numero, status: l.status, etag: l.etag,
    vigenciaInicio: l.vigencia_inicio, modo: l.modo_publicacao, justificativa: l.justificativa,
    criadoEm: l.criado_em,
    // a v1 da carga inicial não tem publicado_em (versão publicada não aceita UPDATE): vale a criação
    publicadoEm: l.publicado_em ?? (l.status === "publicada" ? l.criado_em : null),
    atualizadoEm: l.atualizado_em,
    autor: nome(l.autor_publicacao), autorId: l.autor_publicacao ?? null,
    aprovadoPor: nome(l.aprovado_por), aprovadoEm: l.aprovado_em ?? null,
    atualizadoPor: nome(l.atualizado_por), restauradaDe: l.restaurada_de ?? null,
    vigente: l.id === vigenteId,
    agendada: l.status === "publicada" && Date.parse(l.vigencia_inicio) > agora,
  });
  const comConteudo = (l: Linha): VersaoComConteudo => ({ ...resumo(l), conteudo: ConteudoSchema.parse(l.conteudo) });
  const acha = (f: (l: Linha) => boolean) => { const l = linhas.find(f); return l ? comConteudo(l) : null; };

  const publicada = acha((l) => l.id === vigenteId);
  const efetiva = cidade && !publicada ? versaoEfetiva(cidade, publicadas, agora) : undefined;

  return {
    escopo,
    maxPontos: cfg.maxPontos,
    exigirAprovacao: cfg.exigirAprovacao,
    publicada,
    rascunho: acha((l) => l.status === "rascunho"),
    aguardando: acha((l) => l.status === "aguardando_aprovacao"),
    herdada: efetiva ? { numero: efetiva.numero, conteudo: { criterios: efetiva.versao.criterios, faixas: efetiva.versao.faixas } } : null,
    historico: linhas.filter((l) => l.status !== "rascunho").map(resumo),
  };
}
