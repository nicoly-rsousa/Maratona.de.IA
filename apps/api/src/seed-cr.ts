import { CENARIOS_CR, CODIGOS, NovaOSSchema, coordenadaDemo } from "@farol/shared";
import { db } from "./db.js";
import { criarOS } from "./services/os.js";

// Cria as OS dos cenários de referência CR-01 a CR-04 (relatório, seção 12) em BH, pelo MESMO caminho do POST /os
// (motor de @farol/shared → ordens_servico + resultados_prioridade), marcadas demo=true. Os dados são os mesmos de
// packages/shared/src/cenarios.test.ts. Pesos e faixas continuam DEMONSTRATIVOS (ND01–ND03).
// Idempotente: um cenário já existe quando há OS demo=true na mesma cidade com o mesmo endereço ("CR-01 A — …").
// Pré-requisitos: 0001 a 0005, seed.sql (cidades, equipes e regras) e `npm run seed` (versão v1).

const cidadesUsadas = [...new Set(CENARIOS_CR.map((o) => o.cidade))];
const { data: cidades, error: eC } = await db.from("cidades").select("id, lat, lng").in("id", cidadesUsadas);
if (eC) throw new Error(`Erro ao ler cidades: ${eC.message}`);
const centro = new Map((cidades ?? []).map((c) => [c.id as string, c]));
for (const id of cidadesUsadas) {
  const c = centro.get(id);
  if (!c || c.lat == null || c.lng == null) {
    console.error(`Cidade ${id} ausente ou sem lat/lng. Rode supabase/seed.sql antes.`);
    process.exit(1);
  }
}

const { data: existentes, error: eE } = await db.from("ordens_servico").select("cidade_id, endereco").eq("demo", true).in("cidade_id", cidadesUsadas);
if (eE) throw new Error(`Erro ao ler OS existentes: ${eE.message}`);
const jaExiste = new Set((existentes ?? []).map((o) => `${o.cidade_id}|${o.endereco}`));

let criadas = 0;
let puladas = 0;
for (const o of CENARIOS_CR) {
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
    console.log(`+ ${os.numero}  ${CODIGOS[resultado.codigo].padEnd(9)} nível ${resultado.nivel}  ${String(resultado.pontos).padStart(3)} pts  ${o.endereco}`);
  } catch (e) {
    console.error(`Falha em "${o.endereco}": ${(e as Error).message}`);
    if (/versão de pontuação/i.test((e as Error).message)) console.error("Rode `npm run seed -w @farol/api` para criar a versão v1 demonstrativa.");
    process.exit(1);
  }
}
console.log(`Cenários CR-01 a CR-04: ${criadas} OS criadas, ${puladas} já existiam.`);
process.exit(0);
