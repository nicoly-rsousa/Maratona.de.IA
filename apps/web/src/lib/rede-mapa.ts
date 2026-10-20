// Estilo e enquadramento dos pontos do mapa da rede: funções PURAS (sem Leaflet e sem React), para testar sem o navegador.
import { COR_SEM_MAPA, estiloDaPrioridade, semCircuitoIdentificado } from "./rede";
import type { OSRedeLeve } from "./rede-api";

/** Cores do tema (variáveis CSS --c0…--c4, --tx, --bg…) já lidas do documento; o Leaflet não resolve var() em canvas. */
export type CoresTema = Readonly<Record<string, string>>;

/** Reserva para antes de o tema ser lido (iguais aos tokens do tema escuro em globals.css). */
export const CORES_RESERVA: CoresTema = {
  "--c0": "#ff3d8b", "--c1": "#ff5a3c", "--c2": "#f2a900", "--c3": "#4f9cff", "--c4": "#7d9a8c", "--tx": "#dbe4ee", "--bg": "#0f1419",
};

export const CORES_DO_TEMA = ["--c0", "--c1", "--c2", "--c3", "--c4", "--tx", "--bg", "--ac", "--mu"] as const;

export interface EstiloPonto {
  radius: number;
  color: string;
  weight: number;
  opacity: number;
  fill: boolean;
  fillColor: string;
  fillOpacity: number;
  /** contorno tracejado = SEM MAPA (nunca só pela cor) */
  dashArray: string | null;
}

export const TRACEJADO_SEM_MAPA = "3 3";

/**
 * Regras visuais (a legenda descreve as mesmas):
 *  - ponto cheio na cor da classe (prioridade legada mapeada, informativa);
 *  - SEM MAPA: cinza com contorno tracejado;
 *  - circuito NÃO identificado: ANEL VAZADO (sem preenchimento) na cor da classe;
 *  - selecionada: maior e com contorno de alto contraste.
 */
export function estiloDoPonto(
  o: Pick<OSRedeLeve, "prioridade_codigo" | "circuito" | "circuito_origem">,
  cores: CoresTema,
  selecionada = false,
): EstiloPonto {
  const e = estiloDaPrioridade(o.prioridade_codigo);
  const cor = e.semMapa ? COR_SEM_MAPA : (cores[e.variavelCss!] || CORES_RESERVA[e.variavelCss!] || COR_SEM_MAPA);
  const anel = semCircuitoIdentificado([o as OSRedeLeve]).length > 0;
  const contorno = cores["--tx"] || CORES_RESERVA["--tx"]!;
  const borda = cores["--bg"] || CORES_RESERVA["--bg"]!;

  let s: EstiloPonto;
  if (anel) {
    s = { radius: 8, color: cor, weight: 3, opacity: 1, fill: false, fillColor: cor, fillOpacity: 0, dashArray: e.semMapa ? TRACEJADO_SEM_MAPA : null };
  } else if (e.semMapa) {
    s = { radius: 6, color: "#444444", weight: 2, opacity: 1, fill: true, fillColor: cor, fillOpacity: 0.85, dashArray: TRACEJADO_SEM_MAPA };
  } else {
    s = { radius: 5, color: borda, weight: 1.5, opacity: 1, fill: true, fillColor: cor, fillOpacity: 0.92, dashArray: null };
  }
  return selecionada ? { ...s, radius: s.radius + 4, color: contorno, weight: s.weight + 1.5, dashArray: null } : s;
}

export type Limites = [[number, number], [number, number]];

const finito = (n: number | null): n is number => typeof n === "number" && Number.isFinite(n);
export const temCoordenada = (o: Pick<OSRedeLeve, "lat" | "lng">): o is { lat: number; lng: number } & typeof o => finito(o.lat) && finito(o.lng);

/** Retângulo [[sul, oeste], [norte, leste]] que contém todas as OS com coordenada; null se nenhuma tiver. */
export function limitesDasOS(os: readonly Pick<OSRedeLeve, "lat" | "lng">[]): Limites | null {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const o of os) {
    if (!temCoordenada(o)) continue;
    minLat = Math.min(minLat, o.lat); maxLat = Math.max(maxLat, o.lat);
    minLng = Math.min(minLng, o.lng); maxLng = Math.max(maxLng, o.lng);
  }
  return minLat === Infinity ? null : [[minLat, minLng], [maxLat, maxLng]];
}

/** Texto do tooltip (hover) e do detalhe: número, classe informativa, prioridade legada original e alerta de circuito. */
export function textoDoPonto(o: Pick<OSRedeLeve, "numero" | "prioridade_codigo" | "prioridade_legada" | "circuito" | "circuito_origem">): string {
  const e = estiloDaPrioridade(o.prioridade_codigo);
  const legada = o.prioridade_legada ? ` (legada: ${o.prioridade_legada})` : "";
  const alerta = semCircuitoIdentificado([o as OSRedeLeve]).length > 0 ? " · circuito não identificado" : "";
  return `${o.numero} · ${e.rotulo}${legada}${alerta}`;
}
