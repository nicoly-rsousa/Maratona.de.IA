// Farol v2 — funções puras do mapa da rede (sem I/O). Seção 15 do REGRADENEGOCIO.
// Nenhuma regra de negócio fixa aqui: o mapa de prioridade legada, o raio e os perfis vêm de `configuracoes`.

/** Cores do traçado por TRECHO (campo `trecho`), como na visão "Sentinela". */
export const CORES_TRECHO: Record<number, string> = { 1: "#e31a1c", 2: "#121dd9", 3: "#069e17", 4: "#ff7f00" };
export const COR_TRECHO_DESCONHECIDO = "#888888";

export function corDoTrecho(trecho: number | string | null | undefined): string {
  return CORES_TRECHO[Number(trecho)] ?? COR_TRECHO_DESCONHECIDO;
}

export interface SegmentoTracado { rede: string; trecho: number }

/** Visibilidade pela REDE (LV = baixa tensão), nunca pelo trecho: 51 segmentos LV têm trecho 3. */
export function segmentoVisivel(s: Pick<SegmentoTracado, "rede">, incluirBaixaTensao: boolean): boolean {
  return s.rede !== "LV" || incluirBaixaTensao;
}

/** "FU - Chave Fusível" → "Chave Fusível". Sem o padrão "SIGLA - nome", devolve o texto; vazio → "Tipo não informado". */
export function nomeTipoUnidade(tipoUnidade: string | null | undefined): string {
  const t = (tipoUnidade ?? "").trim();
  if (t === "") return "Tipo não informado";
  const m = /^[A-Z0-9]{1,4}\s+-\s+(.+)$/.exec(t);
  return m ? m[1]!.trim() : t;
}

// ───────── Prioridade legada (informativa) ─────────
export type MapaPrioridadeLegada = Record<string, number>;

/** Código do Farol (0–4) para a prioridade legada, ou null quando o valor não está no mapa ("sem mapa", nunca risco zero). */
export function codigoDaPrioridadeLegada(valor: string | null | undefined, mapa: MapaPrioridadeLegada): number | null {
  const v = (valor ?? "").trim();
  if (v === "") return null;
  const c = Object.prototype.hasOwnProperty.call(mapa, v) ? mapa[v] : undefined;
  return typeof c === "number" && Number.isInteger(c) && c >= 0 && c <= 4 ? c : null;
}

// ───────── Raio ─────────
export interface ConfigRaio { raioPadraoM: number; raioMaxM: number }

export type ResultadoRaio = { ok: true; raioM: number } | { ok: false; erro: string };

/** Valida o raio pedido contra o máximo configurado. Sem valor → padrão. A API recusa (400) acima do máximo. */
export function validarRaio(pedido: number | null | undefined, cfg: ConfigRaio): ResultadoRaio {
  if (pedido === null || pedido === undefined) return { ok: true, raioM: Math.min(cfg.raioPadraoM, cfg.raioMaxM) };
  if (!Number.isFinite(pedido) || pedido <= 0) return { ok: false, erro: "Raio inválido." };
  if (pedido > cfg.raioMaxM) return { ok: false, erro: `Raio acima do máximo configurado (${cfg.raioMaxM} m).` };
  return { ok: true, raioM: Math.round(pedido) };
}

/** Para o slider: mantém o valor dentro de [100 m, máximo], em passos inteiros. */
export function ajustarRaioDoSlider(valor: number, cfg: ConfigRaio): number {
  if (!Number.isFinite(valor)) return Math.min(cfg.raioPadraoM, cfg.raioMaxM);
  return Math.max(Math.min(100, cfg.raioMaxM), Math.min(cfg.raioMaxM, Math.round(valor)));
}

// ───────── Perfis ─────────
export function perfilVeRede(perfil: string, perfisComAcesso: readonly string[]): boolean {
  return perfisComAcesso.includes(perfil);
}

// ───────── Contorno aproximado ─────────
export interface Ponto { lat: number; lng: number }

export type Contorno =
  | { tipo: "pontos"; pontos: Ponto[] }                    // menos de 3 chaves (ou colineares): só pontos, sem polígono
  | { tipo: "poligono"; vertices: Ponto[] };              // envoltória convexa (aproximada)

function cruz(o: Ponto, a: Ponto, b: Ponto): number {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
}

/** Envoltória convexa (cadeia monótona de Andrew). Menos de 3 pontos distintos, ou todos colineares → só pontos. */
export function contornoAproximado(entrada: readonly Ponto[]): Contorno {
  const vistos = new Set<string>();
  const pts = entrada
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .filter((p) => { const k = `${p.lat},${p.lng}`; if (vistos.has(k)) return false; vistos.add(k); return true; })
    .sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  if (pts.length < 3) return { tipo: "pontos", pontos: pts };
  const baixo: Ponto[] = [];
  for (const p of pts) {
    while (baixo.length >= 2 && cruz(baixo[baixo.length - 2]!, baixo[baixo.length - 1]!, p) <= 0) baixo.pop();
    baixo.push(p);
  }
  const cima: Ponto[] = [];
  for (const p of [...pts].reverse()) {
    while (cima.length >= 2 && cruz(cima[cima.length - 2]!, cima[cima.length - 1]!, p) <= 0) cima.pop();
    cima.push(p);
  }
  const vertices = [...baixo.slice(0, -1), ...cima.slice(0, -1)];
  return vertices.length < 3 ? { tipo: "pontos", pontos: pts } : { tipo: "poligono", vertices };
}
