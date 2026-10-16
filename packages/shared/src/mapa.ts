import { distanciaM } from "./duplicidade";
import { temLocalizacao } from "./solicitacao";

/** OS aberta no mapa. Sem dados pessoais: nada de endereço, UC ou transformador. */
export interface OSMapa {
  id: string;
  num: string;
  cidade: string;
  /** null = a OS não tem coordenadas ("localização aproximada"): aparece na lista, não no mapa */
  lat: number | null;
  lng: number | null;
  codigo: number;
  nivel: number;
  status: string;
  tipo: string;
}

export interface EquipeMapa {
  id: string;
  cidade: string;
  lat: number | null;
  lng: number | null;
  capacidade: number;
  /** despachos ativos (designada, a caminho, em execução) */
  emUso: number;
}

/** GET /mapa?cidade= */
export interface RespostaMapa {
  /** cidade pedida ou "*" */
  cidade: string;
  /** raio da sugestão de duplicidade (§11): a MESMA constante da API, para o círculo do mapa */
  raioM: number;
  /** centro da cidade; null em "todas as cidades" ou sem coordenadas cadastradas */
  centro: { lat: number; lng: number } | null;
  os: OSMapa[];
  equipes: EquipeMapa[];
}

export const CIDADE_MAPA_RE = /^(\*|[A-Z]{2,5})$/;

export type EscopoMapa = { ok: true } | { ok: false; motivo: "todas_cidades" | "fora_do_escopo" };

/** Escopo da consulta (§8): "*" só com acesso a todas as cidades; cidade só se estiver nos vínculos do usuário. */
export function escopoDoMapa(cidade: string, ator: { todasCidades: boolean; cidades: readonly string[] }): EscopoMapa {
  if (cidade === "*") return ator.todasCidades ? { ok: true } : { ok: false, motivo: "todas_cidades" };
  return ator.todasCidades || ator.cidades.includes(cidade) ? { ok: true } : { ok: false, motivo: "fora_do_escopo" };
}

export const temPonto = <T extends { lat: number | null; lng: number | null }>(x: T): x is T & { lat: number; lng: number } =>
  temLocalizacao(x.lat, x.lng);

/** Ordem da lista "OS no mapa": precedência, código (mais urgente primeiro), número da OS. */
export function ordenarOSMapa<T extends Pick<OSMapa, "nivel" | "codigo" | "num">>(os: readonly T[]): T[] {
  return [...os].sort((a, b) => b.nivel - a.nivel || a.codigo - b.codigo || a.num.localeCompare(b.num));
}

export interface DistanciaEquipe {
  equipe: EquipeMapa;
  /** metros em LINHA RETA (haversine), sem rota nem tempo; null se faltar coordenada em um dos lados */
  distanciaM: number | null;
}

/** Equipes da cidade da OS, da mais próxima à mais distante (sem coordenada por último). */
export function distanciasAteEquipes(os: Pick<OSMapa, "cidade" | "lat" | "lng">, equipes: readonly EquipeMapa[]): DistanciaEquipe[] {
  return equipes
    .filter((e) => e.cidade === os.cidade)
    .map((equipe) => ({
      equipe,
      distanciaM: temPonto(os) && temPonto(equipe) ? Math.round(distanciaM(os, equipe)) : null,
    }))
    .sort((a, b) => (a.distanciaM ?? Infinity) - (b.distanciaM ?? Infinity) || a.equipe.id.localeCompare(b.equipe.id));
}

/** Outras OS dentro do raio de duplicidade em torno da selecionada (limite inclusivo, como em §11). */
export function osNoRaio<T extends Pick<OSMapa, "id" | "lat" | "lng">>(sel: T, outras: readonly T[], raioM: number): T[] {
  if (!temPonto(sel)) return [];
  return outras.filter((o) => o.id !== sel.id && temPonto(o) && distanciaM(sel, o) <= raioM);
}

/**
 * Ponto clicado no mapa → latitude/longitude do formulário. O Leaflet devolve longitudes fora de ±180
 * ao arrastar o mapa por outra "cópia" do mundo: normaliza e arredonda (6 casas ≈ 0,1 m). null se inválido.
 */
export function coordenadaDoClique(lat: number, lng: number): { lat: number; lng: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const l = ((((lng + 180) % 360) + 360) % 360) - 180;
  const p = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(l * 1e6) / 1e6 };
  return temLocalizacao(p.lat, p.lng) ? p : null;
}
