import { STATUS_ABERTOS, type StatusOS } from "./status";

/**
 * Parâmetros da sugestão de duplicidade (§11). Valores de partida: o banco ainda não tem tabela de
 * configuração, então a API os lê do ambiente e cai neste padrão (DEMONSTRATIVO, configurável).
 */
export interface ParamsDuplicidade {
  raioM: number;
  janelaH: number;
}
export const PARAMS_DUPLICIDADE_PADRAO: ParamsDuplicidade = { raioM: 300, janelaH: 24 };

export type MotivoDuplicidade = "proximidade" | "mesmo_transformador" | "mesma_uc" | "mesmo_conjunto_e_tipo";

export interface ConsultaDuplicidade {
  cidade: string;
  endereco?: string | null;
  lat?: number | null;
  lng?: number | null;
  transformador?: string | null;
  uc?: string | null;
  conjunto?: string | null;
  tipo?: string | null;
}

export interface CandidataDuplicidade {
  id: string;
  numero: string;
  cidade: string;
  endereco: string;
  status: string;
  codigo: number;
  tipo: string;
  lat: number | null;
  lng: number | null;
  transformador: string | null;
  uc: string | null;
  conjunto: string | null;
  abertaEmMs: number;
}

export interface SugestaoDuplicidade extends CandidataDuplicidade {
  motivos: MotivoDuplicidade[];
  /** metros em linha reta; null quando falta coordenada em um dos lados */
  distanciaM: number | null;
  /** só informativo: mesma rua sozinha NÃO gera sugestão (§11) */
  mesmoEndereco: boolean;
}

/** Distância em linha reta (haversine), em metros. */
export function distanciaM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function normalizarEndereco(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const igual = (a?: string | null, b?: string | null) => !!a && !!b && a.trim() === b.trim();
const tem = (n?: number | null): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * Sugestão (nunca automática) para OS abertas da MESMA cidade, dentro da janela, com: distância ≤ raio,
 * mesmo transformador, mesma UC, ou mesmo conjunto + mesmo tipo. Mais próximas primeiro.
 */
export function sugerirDuplicidade(
  q: ConsultaDuplicidade,
  candidatas: CandidataDuplicidade[],
  agoraMs: number,
  params: ParamsDuplicidade = PARAMS_DUPLICIDADE_PADRAO,
): SugestaoDuplicidade[] {
  const ponto = tem(q.lat) && tem(q.lng) ? { lat: q.lat, lng: q.lng } : null;
  const end = normalizarEndereco(q.endereco);
  const out: SugestaoDuplicidade[] = [];

  for (const c of candidatas) {
    if (c.cidade !== q.cidade) continue;
    if (!STATUS_ABERTOS(c.status as StatusOS)) continue;
    if (agoraMs - c.abertaEmMs > params.janelaH * 3_600_000) continue;

    const dist = ponto && tem(c.lat) && tem(c.lng) ? distanciaM(ponto, { lat: c.lat, lng: c.lng }) : null;
    const motivos: MotivoDuplicidade[] = [];
    if (dist != null && dist <= params.raioM) motivos.push("proximidade");
    if (igual(q.transformador, c.transformador)) motivos.push("mesmo_transformador");
    if (igual(q.uc, c.uc)) motivos.push("mesma_uc");
    if (igual(q.conjunto, c.conjunto) && !!q.tipo && q.tipo === c.tipo) motivos.push("mesmo_conjunto_e_tipo");
    if (!motivos.length) continue;

    out.push({ ...c, motivos, distanciaM: dist == null ? null : Math.round(dist), mesmoEndereco: !!end && end === normalizarEndereco(c.endereco) });
  }
  return out.sort(
    (a, b) => (a.distanciaM ?? Infinity) - (b.distanciaM ?? Infinity) || b.abertaEmMs - a.abertaEmMs || a.numero.localeCompare(b.numero),
  );
}
