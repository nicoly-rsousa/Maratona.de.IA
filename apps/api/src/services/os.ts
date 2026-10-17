import { calcularPrioridade, fatosAutomaticos, statusInicial, validarFatos, type CandidataDuplicidade, type Fatos, type NovaOS } from "@farol/shared";
import { regrasEmVigor, versaoVigente } from "../config.js";
<<<<<<< HEAD
import { STATUS_FINAIS, db, type Linha } from "../db.js";
=======
import { db } from "../db.js";
import { env } from "../env.js";
>>>>>>> 70f612613baaea41e96096aa9c5b0e731ed1826e

/** Entrada inválida (vira 400 na rota). */
export class ErroDeEntrada extends Error {}

/** OS abertas da cidade, na janela de duplicidade (§11): mesma consulta usada por GET /os/duplicidade e pela importação em lote. */
export async function candidatasAbertasDaCidade(cidade: string): Promise<CandidataDuplicidade[]> {
  const desde = new Date(Date.now() - env.DUP_JANELA_H * 3_600_000).toISOString();
  const { data, error } = await db
    .from("ordens_servico")
    .select("id, numero, cidade_id, endereco, status, codigo, tipo, lat, lng, transformador, uc, conjunto, aberta_em")
    .eq("cidade_id", cidade)
    .not("status", "in", "(Concluída,Cancelada)")
    .gte("aberta_em", desde)
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((o) => ({
    id: o.id, numero: o.numero, cidade: o.cidade_id, endereco: o.endereco, status: o.status, codigo: o.codigo, tipo: o.tipo,
    lat: o.lat, lng: o.lng, transformador: o.transformador, uc: o.uc, conjunto: o.conjunto, abertaEmMs: Date.parse(o.aberta_em),
  }));
}

/** OS abertas (todas as colunas), lidas em páginas: o PostgREST corta em 1000 linhas por consulta. */
export async function lerAbertas(colunas = "*"): Promise<Linha[]> {
  const PAGINA = 1000;
  const todas: Linha[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await db.from("ordens_servico").select(colunas).not("status", "in", STATUS_FINAIS).order("id").range(de, de + PAGINA - 1);
    if (error) throw new Error(`Erro ao ler as OS abertas: ${error.message}`);
    todas.push(...((data ?? []) as unknown as Linha[]));
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

  const { data: num, error: e1 } = await db.rpc("proximo_numero_os", { p_cidade: d.cidade });
  if (e1) throw new Error(e1.message);

  const { data: os, error: e2 } = await db.from("ordens_servico").insert({
    numero: num, cidade_id: d.cidade, endereco: d.endereco, lat: d.lat ?? null, lng: d.lng ?? null,
    transformador: d.transformador ?? null, uc: d.uc ?? null, circuito: d.circuito ?? null, conjunto: d.conjunto ?? null,
    exige_qualificacao: d.exigeQualificacao ?? null, demo: opts.demo ?? false,
    tipo: d.tipo, fatos: d.fatos,
    prazo_limite: d.prazoH == null ? null : new Date(agora + d.prazoH * 3_600_000).toISOString(),
    status: statusInicial(d.lat, d.lng), // §14.7
    versao_pontuacao_id: versaoId, regras_versao: regrasVersao, nivel: r.nivel, codigo: r.codigo, pontos: r.pontos,
    aberta_em: new Date(abertaEmMs).toISOString(),
  }).select().single();
  if (e2 || !os) throw new Error(e2?.message ?? "Falha ao gravar a OS.");

  const { error: e3 } = await db.from("resultados_prioridade").insert({
    os_id: os.id, versao: r.versao, itens: r.itens, pontos: r.pontos, codigo_faixa: r.codigoFaixa,
    regras_aplicadas: r.regrasAplicadas, nivel: r.nivel, codigo: r.codigo,
    motivo_principal: r.motivoPrincipal, motivo_calculo: "Abertura",
  });
  if (e3) throw new Error(`OS ${os.numero} criada, mas o resultado de prioridade falhou: ${e3.message}`);

  const { error: e4 } = await db.from("solicitacoes").insert({
    os_id: os.id, cidade_id: os.cidade_id, origem: "abertura", endereco: d.endereco, lat: d.lat ?? null, lng: d.lng ?? null,
    transformador: d.transformador ?? null, uc: d.uc ?? null, fatos: d.fatos, criado_por: opts.usuario ?? null, criado_em: os.aberta_em,
  });
  if (e4) throw new Error(`OS ${os.numero} criada, mas a solicitação de abertura falhou: ${e4.message}`);
  return { os, resultado: r };
}
