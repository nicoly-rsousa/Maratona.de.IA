import { pathToFileURL } from "node:url";
import { planejarReclassificacao, type Fatos, type Regra, type VersaoPublicada } from "@farol/shared";
import { db } from "../db.js";
import { carregarPublicadas, regrasAtivas } from "../config.js";

type LinhaOS = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- linha de ordens_servico

/**
 * Recalcula uma OS com a versão em que ela está (`versao_pontuacao_id`), nunca com a vigente (§5, §7).
 * `migrar` só é ligado pela rotina das OS abertas: aí a OS passa para uma versão nova publicada com
 * "reclassificar abertas" cuja vigência chegou, gravando um resultado "Nova versão vN" e o novo vínculo.
 * Fora disso só grava resultado (e atualiza o cache) se código, pontos ou precedência mudarem.
 */
export async function reclassificarOS(
  o: LinhaOS, regras: Regra[], publicadas: VersaoPublicada[], agora: number, motivo: string, opts: { migrar?: boolean } = {},
): Promise<boolean> {
  const plano = planejarReclassificacao(
    {
      cidade: o.cidade_id, tipo: o.tipo, fatos: (o.fatos ?? {}) as Fatos, abertaEmMs: Date.parse(o.aberta_em),
      prazoLimiteMs: o.prazo_limite ? Date.parse(o.prazo_limite) : null, versaoId: o.versao_pontuacao_id ?? null,
      anterior: { codigo: o.codigo, pontos: o.pontos, nivel: o.nivel },
    },
    { publicadas, regras, agoraMs: agora, migrar: opts.migrar ?? false, motivo },
  );
  if (!plano) throw new Error(`Nenhuma versão de pontuação publicada e vigente para a OS ${o.numero}.`);
  if (!plano.gravar) return false;

  const r = plano.resultado;
  const { error: e1 } = await db.from("resultados_prioridade").insert({
    os_id: o.id, versao: r.versao, itens: r.itens, pontos: r.pontos, codigo_faixa: r.codigoFaixa,
    regras_aplicadas: r.regrasAplicadas, nivel: r.nivel, codigo: r.codigo,
    motivo_principal: r.motivoPrincipal, motivo_calculo: plano.motivo,
  });
  if (e1) throw new Error(`Erro ao gravar o resultado da OS ${o.numero}: ${e1.message}`);
  const { error: e2 } = await db.from("ordens_servico")
    .update({ nivel: r.nivel, codigo: r.codigo, pontos: r.pontos, versao_pontuacao_id: plano.versao.id, atualizada_em: new Date().toISOString() }).eq("id", o.id);
  if (e2) throw new Error(`Erro ao atualizar a OS ${o.numero}: ${e2.message}`);
  return true;
}

/**
 * Rotina das OS abertas (§7): recalcula os fatos dependentes do tempo, sempre com a versão de cada OS,
 * e aplica as versões novas publicadas com "reclassificar abertas" cuja vigência chegou.
 */
export async function reclassificarAbertas(): Promise<number> {
  const { data: abertas, error } = await db.from("ordens_servico").select("*").not("status", "in", "(Concluída,Cancelada)");
  if (error) throw new Error(`Erro ao ler as OS abertas: ${error.message}`);
  if (!abertas?.length) return 0;
  const [regras, publicadas] = await Promise.all([regrasAtivas(), carregarPublicadas()]);
  const agora = Date.now();
  let alteradas = 0;
  for (const o of abertas) {
    if (await reclassificarOS(o, regras, publicadas, agora, "Reclassificação automática (tempo)", { migrar: true })) alteradas++;
  }
  return alteradas;
}

// Execução direta como Cron Job do Render
// (pathToFileURL: `file://${argv[1]}` não casa no Windows nem sob tsx)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reclassificarAbertas()
    .then((n) => { console.log(`Reclassificadas: ${n}`); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
