import { pathToFileURL } from "node:url";
import { planejarReclassificacao, type Fatos, type Regra, type VersaoPublicada } from "@farol/shared";
import { db, type Linha } from "../db.js";
import { carregarPublicadas, regrasEmVigor } from "../config.js";
import { lerAbertas } from "../services/os.js";


/**
 * Recalcula uma OS com a versão em que ela está (`versao_pontuacao_id`), nunca com a vigente (§5, §7).
 * `migrar` só é ligado pela rotina das OS abertas: aí a OS passa para uma versão nova publicada com
 * "reclassificar abertas" cuja vigência chegou, gravando um resultado "Nova versão vN" e o novo vínculo.
 * Fora disso só grava resultado (e atualiza o cache) se código, pontos ou precedência mudarem.
 *
 * `opts.regras` = versão do conjunto de regras com que `regras` foi carregado. A OS fica carimbada com ela (`regras_versao`):
 * se a OS estava numa versão ANTERIOR (ou sem carimbo), o carimbo avança mesmo quando nada mudou, e só há resultado novo se
 * código, pontos ou precedência mudarem. Com `motivoDeRegras` (a rotina), o motivo vira "Regras vN: <justificativa>".
 */
export async function reclassificarOS(
  o: Linha, regras: Regra[], publicadas: VersaoPublicada[], agora: number, motivo: string,
  opts: { migrar?: boolean; regras?: { numero: number; justificativa: string }; motivoDeRegras?: boolean } = {},
): Promise<boolean> {
  const plano = planejarReclassificacao(
    {
      cidade: o.cidade_id, tipo: o.tipo, fatos: (o.fatos ?? {}) as Fatos, abertaEmMs: Date.parse(o.aberta_em),
      prazoLimiteMs: o.prazo_limite ? Date.parse(o.prazo_limite) : null, versaoId: o.versao_pontuacao_id ?? null,
      anterior: { codigo: o.codigo, pontos: o.pontos, nivel: o.nivel }, regrasVersao: o.regras_versao ?? null,
    },
    {
      publicadas, regras, agoraMs: agora, migrar: opts.migrar ?? false, motivo,
      versaoRegras: opts.regras && { ...opts.regras, motivoDeRegras: opts.motivoDeRegras },
    },
  );
  if (!plano) throw new Error(`Nenhuma versão de pontuação publicada e vigente para a OS ${o.numero}.`);
  const carimbo = plano.regrasVersao != null ? { regras_versao: plano.regrasVersao } : {};
  if (!plano.gravar) {
    if (plano.desatualizada) {
      const { error } = await db.from("ordens_servico").update(carimbo).eq("id", o.id);
      if (error) throw new Error(`Erro ao atualizar a versão das regras da OS ${o.numero}: ${error.message}`);
    }
    return false;
  }
  const r = plano.resultado;
  const { error: e1 } = await db.from("resultados_prioridade").insert({
    os_id: o.id, versao: r.versao, itens: r.itens, pontos: r.pontos, codigo_faixa: r.codigoFaixa,
    regras_aplicadas: r.regrasAplicadas, nivel: r.nivel, codigo: r.codigo,
    motivo_principal: r.motivoPrincipal, motivo_calculo: plano.motivo,
  });
  if (e1) throw new Error(`Erro ao gravar o resultado da OS ${o.numero}: ${e1.message}`);
  const { error: e2 } = await db.from("ordens_servico")
    .update({ nivel: r.nivel, codigo: r.codigo, pontos: r.pontos, versao_pontuacao_id: plano.versao.id, ...carimbo, atualizada_em: new Date().toISOString() }).eq("id", o.id);
  if (e2) throw new Error(`Erro ao atualizar a OS ${o.numero}: ${e2.message}`);
  return true;
}

/**
 * Rotina das OS abertas (§7): recalcula os fatos dependentes do tempo, sempre com a versão de cada OS,
 * e aplica as versões novas publicadas com "reclassificar abertas" cuja vigência chegou.
 */
async function executar(): Promise<number> {
  const abertas = await lerAbertas();
  if (!abertas.length) return 0;
  // A versão das regras vem junto das regras: OS com versão anterior são recalculadas e carimbadas (§4).
  const [em, publicadas] = await Promise.all([regrasEmVigor(), carregarPublicadas()]);
  const agora = Date.now();
  let alteradas = 0;
  for (const o of abertas) {
    if (await reclassificarOS(o, em.regras, publicadas, agora, "Reclassificação automática (tempo)", { migrar: true, regras: em, motivoDeRegras: true })) alteradas++;
  }
  return alteradas;
}

/** Uma execução por vez neste processo: o intervalo de 60 s e a gravação de regras não se atropelam (nem duplicam resultados). */
let emAndamento: Promise<number> | null = null;
export function reclassificarAbertas(): Promise<number> {
  emAndamento ??= executar().finally(() => { emAndamento = null; });
  return emAndamento;
}

// Execução direta como Cron Job do Render
// (pathToFileURL: `file://${argv[1]}` não casa no Windows nem sob tsx)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reclassificarAbertas()
    .then((n) => { console.log(`Reclassificadas: ${n}`); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
