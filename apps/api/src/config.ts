import { RegraSchema, VersaoPontuacaoSchema, type Regra, type VersaoPontuacao } from "@farol/shared";
import { db } from "./db.js";

/** Versão publicada e vigente: a da cidade prevalece sobre a global (§5). */
export async function versaoVigente(cidade: string): Promise<{ id: string; versao: VersaoPontuacao }> {
  const { data, error } = await db
    .from("versoes_pontuacao")
    .select("id, numero, conteudo, cidade_id")
    .eq("status", "publicada")
    .lte("vigencia_inicio", new Date().toISOString())
    .or(`cidade_id.eq.${cidade},cidade_id.is.null`)
    .order("numero", { ascending: false });
  if (error || !data?.length) throw new Error("Nenhuma versão de pontuação publicada.");
  const row = data.find((r) => r.cidade_id === cidade) ?? data[0]!;
  const versao = VersaoPontuacaoSchema.parse({ ...(row.conteudo as object), v: row.numero });
  return { id: row.id as string, versao };
}

export async function regrasAtivas(): Promise<Regra[]> {
  const { data, error } = await db.from("regras_precedencia").select("*").eq("ativa", true);
  if (error) throw error;
  return (data ?? []).map((r) =>
    RegraSchema.parse({ id: r.id, nome: r.nome, ativa: r.ativa, cond: r.cond, nivel: r.nivel, prioridadeMinima: r.prioridade_minima }),
  );
}
