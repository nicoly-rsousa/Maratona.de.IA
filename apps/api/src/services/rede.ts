import { codigoDaPrioridadeLegada, type ConfigRaio, type MapaPrioridadeLegada } from "@farol/shared";
import { db } from "../db.js";

/** Todo valor de regra vem de `configuracoes` (nada fixo no código). Falha de leitura = null → quem chama NEGA. */
async function lerConfig(chave: string): Promise<unknown | null> {
  const { data, error } = await db.from("configuracoes").select("valor").eq("chave", chave).maybeSingle();
  if (error || !data) return null;
  return data.valor ?? null;
}

/** Lista de perfis de uma chave de configuração; null se ausente, ilegível ou fora do formato (→ negar). */
export async function perfisDaConfig(chave: string): Promise<string[] | null> {
  const v = await lerConfig(chave);
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
}

export async function configRaio(): Promise<ConfigRaio | null> {
  const [p, m] = await Promise.all([lerConfig("rede.raio_padrao_m"), lerConfig("rede.raio_max_m")]);
  if (typeof p !== "number" || typeof m !== "number" || !(p > 0) || !(m > 0)) return null;
  return { raioPadraoM: p, raioMaxM: m };
}

export async function mapaPrioridade(): Promise<MapaPrioridadeLegada> {
  const v = await lerConfig("rede.mapa_prioridade_legada");
  return v && typeof v === "object" && !Array.isArray(v) ? (v as MapaPrioridadeLegada) : {};
}

export interface OSRede {
  numero: string; circuito: string | null; circuito_origem: string | null; lat: number | null; lng: number | null;
  municipio: string | null; prioridade_legada: string | null; prazo: string | null; clientes: number | null;
  tipo_servico: string | null; familia_ativo: string | null; origem_geo: string | null;
}
export const COLUNAS_OS = "numero, circuito, circuito_origem, lat, lng, municipio, prioridade_legada, prazo, clientes, tipo_servico, familia_ativo, origem_geo";

/** Ordem INFORMATIVA (não é a fila do Farol): prioridade legada mapeada (sem mapa por último), prazo, número.
 *  Não existe data de abertura em os_importadas; entra aqui quando a base passar a trazê-la. */
export function ordenarInformativo<T extends { prioridade_codigo: number | null; prazo: string | null; numero: string }>(l: T[]): T[] {
  return [...l].sort((a, b) => {
    if ((a.prioridade_codigo === null) !== (b.prioridade_codigo === null)) return a.prioridade_codigo === null ? 1 : -1;
    if (a.prioridade_codigo !== b.prioridade_codigo) return (a.prioridade_codigo as number) - (b.prioridade_codigo as number);
    if ((a.prazo === null) !== (b.prazo === null)) return a.prazo === null ? 1 : -1;
    if (a.prazo !== b.prazo) return (a.prazo as string) < (b.prazo as string) ? -1 : 1;
    return a.numero < b.numero ? -1 : a.numero > b.numero ? 1 : 0;
  });
}

export const comCodigo = <T extends { prioridade_legada: string | null }>(o: T, mapa: MapaPrioridadeLegada) =>
  ({ ...o, prioridade_codigo: codigoDaPrioridadeLegada(o.prioridade_legada, mapa) });

export const AVISO_ORDEM = "Ordem informativa pela prioridade legada mapeada; NÃO é a fila de prioridade do Farol.";

const PAGINA = 1000; // o PostgREST limita cada resposta (api.max_rows = 1000): leitura completa exige paginar
const MAX_PAGINAS = 100;

/** Lê TODAS as linhas de uma consulta paginando com .range(); a consulta precisa ter ORDER BY estável. */
export async function lerTudo<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ linhas: T[]; falha: boolean }> {
  const linhas: T[] = [];
  for (let i = 0; i < MAX_PAGINAS; i++) {
    const { data, error } = await pagina(i * PAGINA, i * PAGINA + PAGINA - 1);
    if (error || !data) return { linhas: [], falha: true };
    linhas.push(...data);
    if (data.length < PAGINA) return { linhas, falha: false };
  }
  return { linhas: [], falha: true }; // passou do teto: melhor falhar do que devolver lista truncada
}

export interface LinhaRegional { municipio: string; regional: string | null }

/** Regional "configurada" = existe ao menos um município com regional preenchida (vazia = filtro não configurado). */
export async function lerRegionais(): Promise<{ linhas: LinhaRegional[]; configurada: boolean; falha: boolean }> {
  const r = await lerTudo<LinhaRegional>((de, ate) => db.from("regional").select("municipio, regional").order("municipio").range(de, ate));
  return { linhas: r.linhas, configurada: r.linhas.some((l) => !!l.regional), falha: r.falha };
}

/** Data da importação que alimenta os_importadas (a carga é "atualização completa": vale a última). */
export async function dataDaImportacao(): Promise<string | null> {
  const { data } = await db.from("importacoes").select("importado_em").order("id", { ascending: false }).limit(1).maybeSingle();
  return (data?.importado_em as string | undefined) ?? null;
}
