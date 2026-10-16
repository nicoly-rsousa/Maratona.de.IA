import { CODIGOS, NovaOSSchema, OS_DEMO, coordenadaDemo } from "@farol/shared";
import { db } from "./db.js";
import { criarOS } from "./services/os.js";

// Insere as 11 OS demonstrativas do protótipo (BH e CT) pelo MESMO caminho do POST /os
// (motor de @farol/shared → ordens_servico + resultados_prioridade).
// Idempotente: uma OS demonstrativa já existe quando há OS na mesma cidade com o mesmo endereço.
// Pré-requisitos: supabase/seed.sql (cidades e regras) e `npm run seed` (versão de pontuação v1).

const cidadesUsadas = [...new Set(OS_DEMO.map((o) => o.cidade))];
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

const { data: existentes, error: eE } = await db.from("ordens_servico").select("cidade_id, endereco").in("cidade_id", cidadesUsadas);
if (eE) throw new Error(`Erro ao ler OS existentes: ${eE.message}`);
const jaExiste = new Set((existentes ?? []).map((o) => `${o.cidade_id}|${o.endereco}`));

let criadas = 0;
let puladas = 0;
for (const o of OS_DEMO) {
  if (jaExiste.has(`${o.cidade}|${o.endereco}`)) { puladas++; continue; }
  const c = centro.get(o.cidade)!;
  const { lat, lng } = coordenadaDemo({ lat: c.lat as number, lng: c.lng as number }, o.x, o.y);
  const dados = NovaOSSchema.parse({
    cidade: o.cidade, endereco: o.endereco, lat, lng, transformador: o.transformador, uc: o.uc,
    tipo: o.tipo, prazoH: o.prazoH, fatos: o.fatos,
  });
  try {
    const { os, resultado } = await criarOS(dados, { abertaEmMs: Date.now() - o.abertaMinAtras * 60_000 });
    criadas++;
    console.log(`+ ${os.numero}  ${CODIGOS[resultado.codigo].padEnd(9)} nível ${resultado.nivel}  ${resultado.pontos} pts  ${o.endereco}`);
  } catch (e) {
    console.error(`Falha em "${o.endereco}": ${(e as Error).message}`);
    if (/versão de pontuação/i.test((e as Error).message)) console.error("Rode `npm run seed -w @farol/api` para criar a versão v1 demonstrativa.");
    process.exit(1);
  }
}
console.log(`OS demonstrativas: ${criadas} criadas, ${puladas} já existiam.`);
process.exit(0);
