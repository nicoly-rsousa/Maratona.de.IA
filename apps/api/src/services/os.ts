import { calcularPrioridade, fatosAutomaticos, statusInicial, validarFatos, type Fatos, type NovaOS } from "@farol/shared";
import { regrasAtivas, versaoVigente } from "../config.js";
import { db } from "../db.js";

/** Entrada inválida (vira 400 na rota). */
export class ErroDeEntrada extends Error {}

/**
 * Cria a OS: calcula a prioridade no motor de @farol/shared e grava OS + resultado imutável.
 * Usado por POST /os e pelo seed:os, para que os dois passem exatamente pelo mesmo caminho.
 * `abertaEmMs` só existe para o seed (OS demonstrativas com tempo de espera já decorrido);
 * `prazoH` é sempre "horas a partir de agora".
 */
export async function criarOS(d: NovaOS, opts: { abertaEmMs?: number } = {}) {
  const [{ id: versaoId, versao }, regras] = await Promise.all([versaoVigente(d.cidade), regrasAtivas()]);
  const invalidos = validarFatos(d.fatos, versao);
  if (invalidos.length) throw new ErroDeEntrada(invalidos.join(" "));

  const agora = Date.now();
  const abertaEmMs = opts.abertaEmMs ?? agora;
  const fatos: Fatos = { ...d.fatos, tipo: d.tipo, ...fatosAutomaticos({ aberturaMs: abertaEmMs, prazoH: d.prazoH }, agora) };
  const r = calcularPrioridade(fatos, versao, regras);

  const { data: num, error: e1 } = await db.rpc("proximo_numero_os", { p_cidade: d.cidade });
  if (e1) throw new Error(e1.message);

  const { data: os, error: e2 } = await db.from("ordens_servico").insert({
    numero: num, cidade_id: d.cidade, endereco: d.endereco, lat: d.lat ?? null, lng: d.lng ?? null,
    transformador: d.transformador ?? null, uc: d.uc ?? null, circuito: d.circuito ?? null, conjunto: d.conjunto ?? null,
    tipo: d.tipo, fatos: d.fatos,
    prazo_limite: d.prazoH == null ? null : new Date(agora + d.prazoH * 3_600_000).toISOString(),
    status: statusInicial(d.lat, d.lng), // §14.7
    versao_pontuacao_id: versaoId, nivel: r.nivel, codigo: r.codigo, pontos: r.pontos,
    aberta_em: new Date(abertaEmMs).toISOString(),
  }).select().single();
  if (e2 || !os) throw new Error(e2?.message ?? "Falha ao gravar a OS.");

  const { error: e3 } = await db.from("resultados_prioridade").insert({
    os_id: os.id, versao: r.versao, itens: r.itens, pontos: r.pontos, codigo_faixa: r.codigoFaixa,
    regras_aplicadas: r.regrasAplicadas, nivel: r.nivel, codigo: r.codigo,
    motivo_principal: r.motivoPrincipal, motivo_calculo: "Abertura",
  });
  if (e3) throw new Error(`OS ${os.numero} criada, mas o resultado de prioridade falhou: ${e3.message}`);
  return { os, resultado: r };
}
