import { calcularPrioridade, fatosAutomaticos, mudou, type Fatos } from "@farol/shared";
import { db } from "../db.js";
import { regrasAtivas, versaoVigente } from "../config.js";

/** Recalcula fatos dependentes do tempo; só grava se código, pontos ou precedência mudarem. */
export async function reclassificarAbertas(): Promise<number> {
  const { data: abertas } = await db.from("ordens_servico").select("*").not("status", "in", "(Concluída,Cancelada)");
  if (!abertas?.length) return 0;
  const regras = await regrasAtivas();
  const agora = Date.now();
  let alteradas = 0;

  for (const o of abertas) {
    const { versao } = await versaoVigente(o.cidade_id);
    const prazoH = o.prazo_limite ? (Date.parse(o.prazo_limite) - agora) / 3_600_000 : null;
    const fatos: Fatos = { ...(o.fatos as Fatos), tipo: o.tipo, ...fatosAutomaticos({ aberturaMs: Date.parse(o.aberta_em), prazoH }, agora) };
    const r = calcularPrioridade(fatos, versao, regras);
    const anterior = { codigo: o.codigo, pontos: o.pontos, nivel: o.nivel };
    if (!mudou({ ...r, ...anterior }, r)) continue;

    await db.from("resultados_prioridade").insert({
      os_id: o.id, versao: r.versao, itens: r.itens, pontos: r.pontos, codigo_faixa: r.codigoFaixa,
      regras_aplicadas: r.regrasAplicadas, nivel: r.nivel, codigo: r.codigo,
      motivo_principal: r.motivoPrincipal, motivo_calculo: "Reclassificação automática (tempo)",
    });
    await db.from("ordens_servico").update({ nivel: r.nivel, codigo: r.codigo, pontos: r.pontos, atualizada_em: new Date().toISOString() }).eq("id", o.id);
    alteradas++;
  }
  return alteradas;
}

// Execução direta como Cron Job do Render
if (import.meta.url === `file://${process.argv[1]}`) {
  reclassificarAbertas().then((n) => { console.log(`Reclassificadas: ${n}`); process.exit(0); });
}
