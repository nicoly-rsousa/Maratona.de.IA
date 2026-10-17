import { CENARIOS_CR } from "@farol/shared";
import { semearOSDemonstrativas } from "./seed-comum.js";

// Cria as OS dos cenários de referência CR-01 a CR-04 (relatório, seção 12) em BH, pelo mesmo caminho do POST /os
// (ver seed-comum.ts). Os dados são os mesmos de packages/shared/src/cenarios.test.ts. Pesos e faixas continuam
// DEMONSTRATIVOS (ND01–ND03). Endereços no formato "CR-01 A — …".
// Pré-requisitos: 0001 a 0005, seed.sql (cidades, equipes e regras) e `npm run seed` (versão v1).

await semearOSDemonstrativas(CENARIOS_CR, (criadas, puladas) => `Cenários CR-01 a CR-04: ${criadas} OS criadas, ${puladas} já existiam.`);
