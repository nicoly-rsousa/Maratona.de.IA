import { CODIGOS, NovaOSSchema, coordenadaDemo, type OSDemo } from "@farol/shared";
import { db } from "./db.js";
import { criarOS } from "./services/os.js";

/**
 * Insere OS demonstrativas pelo MESMO caminho do POST /os (motor de @farol/shared → ordens_servico + resultados_prioridade),
 * marcadas demo=true. Idempotente: pula a OS quando já há OS demo=true na mesma cidade com o mesmo endereço.
 * Falha → `process.exitCode = 1` (sem process.exit: no Node 24 para Windows ele derruba o processo logo após um fetch).
 * Usado por seed-os.ts e seed-cr.ts.
 */
export async function semearOSDemonstrativas(lista: OSDemo[], resumo: (criadas: number, puladas: number) => string): Promise<void> {
  const cidadesUsadas = [...new Set(lista.map((o) => o.cidade))];
  const { data: cidades, error: eC } = await db.from("cidades").select("id, lat, lng").in("id", cidadesUsadas);
  if (eC) throw new Error(`Erro ao ler cidades: ${eC.message}`);
  const centro = new Map((cidades ?? []).map((c) => [c.id as string, c]));
  for (const id of cidadesUsadas) {
    const c = centro.get(id);
    if (!c || c.lat == null || c.lng == null) {
      console.error(`Cidade ${id} ausente ou sem lat/lng. Rode supabase/seed.sql antes.`);
      process.exitCode = 1;
      return;
    }
  }

  const { data: existentes, error: eE } = await db.from("ordens_servico").select("cidade_id, endereco").eq("demo", true).in("cidade_id", cidadesUsadas);
  if (eE) throw new Error(`Erro ao ler OS existentes: ${eE.message}`);
  const jaExiste = new Set((existentes ?? []).map((o) => `${o.cidade_id}|${o.endereco}`));

  let criadas = 0;
  let puladas = 0;
  for (const o of lista) {
    if (jaExiste.has(`${o.cidade}|${o.endereco}`)) { puladas++; continue; }
    const c = centro.get(o.cidade)!;
    const { lat, lng } = coordenadaDemo({ lat: c.lat as number, lng: c.lng as number }, o.x, o.y);
    const dados = NovaOSSchema.parse({
      cidade: o.cidade, endereco: o.endereco, lat, lng, transformador: o.transformador, uc: o.uc,
      tipo: o.tipo, prazoH: o.prazoH, fatos: o.fatos, exigeQualificacao: o.exigeQualificacao,
    });
    try {
      const { os, resultado } = await criarOS(dados, { abertaEmMs: Date.now() - o.abertaMinAtras * 60_000, demo: true });
      criadas++;
      console.log(`+ ${os.numero}  ${CODIGOS[resultado.codigo]!.padEnd(9)} nível ${resultado.nivel}  ${String(resultado.pontos).padStart(3)} pts  ${o.endereco}`);
    } catch (e) {
      console.error(`Falha em "${o.endereco}": ${(e as Error).message}`);
      if (/versão de pontuação/i.test((e as Error).message)) console.error("Rode `npm run seed -w @farol/api` para criar a versão v1 demonstrativa.");
      process.exitCode = 1;
      return;
    }
  }
  console.log(resumo(criadas, puladas));
}
