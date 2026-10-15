import { VERSAO_DEMO } from "@farol/shared";
import { db } from "./db.js";

// Insere a versão de pontuação v1 DEMONSTRATIVA (global), publicada, vigente desde já.
const { data: ja } = await db.from("versoes_pontuacao").select("id").is("cidade_id", null).eq("numero", 1).maybeSingle();
if (ja) { console.log("Versão v1 já existe."); process.exit(0); }

const { error } = await db.from("versoes_pontuacao").insert({
  cidade_id: null, numero: 1, status: "publicada",
  conteudo: { criterios: VERSAO_DEMO.criterios, faixas: VERSAO_DEMO.faixas },
  justificativa: "Carga inicial demonstrativa", vigencia_inicio: new Date(Date.now() - 60_000).toISOString(),
  modo_publicacao: "novas",
});
console.log(error ? `Erro: ${error.message}` : "Versão v1 demonstrativa criada.");
process.exit(error ? 1 : 0);
