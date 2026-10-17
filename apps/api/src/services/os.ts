import { calcularPrioridade, fatosAutomaticos, statusInicial, validarFatos, type Fatos, type NovaOS } from "@farol/shared";
import { regrasEmVigor, versaoVigente } from "../config.js";
import { db } from "../db.js";

/** Entrada inválida (vira 400 na rota). */
export class ErroDeEntrada extends Error {}

/** OS abertas (todas as colunas), lidas em páginas: o PostgREST corta em 1000 linhas por consulta. */
export async function lerAbertas(colunas = "*"): Promise<Record<string, any>[]> { // eslint-disable-line @typescript-eslint/no-explicit-any -- linhas de ordens_servico
  const PAGINA = 1000;
  const todas: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await db.from("ordens_servico").select(colunas).not("status", "in", "(Concluída,Cancelada)").order("id").range(de, de + PAGINA - 1);
    if (error) throw new Error(`Erro ao ler as OS abertas: ${error.message}`);
    todas.push(...((data ?? []) as unknown as Record<string, any>[])); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!data || data.length < PAGINA) return todas;
  }
}

/** Qualificações oferecidas pelas equipes ativas da cidade (valores válidos para "exige qualificação"). */
export async function qualificacoesDaCidade(cidade: string): Promise<string[]> {
  const { data, error } = await db.from("equipes").select("qualificacoes").eq("cidade_id", cidade).eq("ativa", true);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).flatMap((e) => (e.qualificacoes as string[]) ?? []))].sort((a, b) => a.localeCompare(b));
}

/**
 * Cria a OS: calcula a prioridade no motor de @farol/shared e grava OS + resultado imutável
 * + a solicitação de abertura. Usado por POST /os e pelo seed:os, para que os dois passem exatamente
 * pelo mesmo caminho.
 * `abertaEmMs` e `demo` só existem para o seed (OS demonstrativas com tempo de espera já decorrido);
 * `prazoH` é sempre "horas a partir de agora".
 */
export async function criarOS(d: NovaOS, opts: { abertaEmMs?: number; demo?: boolean; usuario?: string } = {}) {
  const [{ id: versaoId, versao }, { numero: regrasVersao, regras }] = await Promise.all([versaoVigente(d.cidade), regrasEmVigor()]);
  const invalidos = validarFatos(d.fatos, versao);
  if (invalidos.length) throw new ErroDeEntrada(invalidos.join(" "));
  if (d.exigeQualificacao && !(await qualificacoesDaCidade(d.cidade)).includes(d.exigeQualificacao)) {
    throw new ErroDeEntrada(`Nenhuma equipe de ${d.cidade} tem a qualificação "${d.exigeQualificacao}".`);
  }

  const agora = Date.now();
  const abertaEmMs = opts.abertaEmMs ?? agora;
  const fatos: Fatos = { ...d.fatos, tipo: d.tipo, ...fatosAutomaticos({ aberturaMs: abertaEmMs, prazoH: d.prazoH }, agora) };
  const r = calcularPrioridade(fatos, versao, regras);

  // Grava OS + resultado de prioridade + solicitação de abertura numa única transação no Postgres
  // (P-04): os 3 inserts viviam soltos aqui, e uma falha no 2º/3º deixava a OS inconsistente.
  const { data: os, error } = await db.rpc("criar_os", {
    p_os: {
      cidade: d.cidade, endereco: d.endereco, lat: d.lat ?? null, lng: d.lng ?? null,
      transformador: d.transformador ?? null, uc: d.uc ?? null, circuito: d.circuito ?? null, conjunto: d.conjunto ?? null,
      exigeQualificacao: d.exigeQualificacao ?? null, demo: opts.demo ?? false,
      tipo: d.tipo, fatos: d.fatos,
      prazoLimite: d.prazoH == null ? null : new Date(agora + d.prazoH * 3_600_000).toISOString(),
      status: statusInicial(d.lat, d.lng), // §14.7
      versaoPontuacaoId: versaoId, regrasVersao, abertaEm: new Date(abertaEmMs).toISOString(),
    },
    p_resultado: r,
    p_usuario: opts.usuario ?? null,
  });
  if (error || !os) throw new Error(error?.message ?? "Falha ao gravar a OS.");
  return { os, resultado: r };
}
