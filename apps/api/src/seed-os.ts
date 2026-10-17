import { OS_DEMO } from "@farol/shared";
import { semearOSDemonstrativas } from "./seed-comum.js";

// Insere as 11 OS demonstrativas do protótipo (BH e CT) pelo mesmo caminho do POST /os (ver seed-comum.ts).
// Pré-requisitos: 0001_init.sql, seed.sql (cidades, equipes e regras), 0002_solicitacoes.sql e `npm run seed` (versão v1).

await semearOSDemonstrativas(OS_DEMO, (criadas, puladas) => `OS demonstrativas: ${criadas} criadas, ${puladas} já existiam.`);
