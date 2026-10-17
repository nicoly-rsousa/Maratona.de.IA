import { VERSAO_DEMO } from "@farol/shared";
import { db } from "./db.js";

// Insere a versão de pontuação v1 DEMONSTRATIVA (global), publicada, vigente desde já.
// Sai pelo `process.exitCode` (sem process.exit): no Node 24 para Windows, process.exit logo após um fetch derruba o
// processo com "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)".
const { data: ja } = await db.from("versoes_pontuacao").select("id").is("cidade_id", null).eq("numero", 1).maybeSingle();
if (ja) {
  console.log("Versão v1 já existe.");
} else {
  const { error } = await db.from("versoes_pontuacao").insert({
    cidade_id: null, numero: 1, status: "publicada",
    conteudo: { criterios: VERSAO_DEMO.criterios, faixas: VERSAO_DEMO.faixas },
    justificativa: "Carga inicial demonstrativa", vigencia_inicio: new Date(Date.now() - 60_000).toISOString(),
    modo_publicacao: "novas",
  });
  console.log(error ? `Erro: ${error.message}` : "Versão v1 demonstrativa criada.");
  process.exitCode = error ? 1 : 0;
}
