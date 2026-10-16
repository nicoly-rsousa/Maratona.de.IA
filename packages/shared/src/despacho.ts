import { distanciaM } from "./duplicidade";

export type EstadoDespacho = "designada" | "a_caminho" | "em_execucao" | "concluida" | "removida";
export const ESTADOS_DESPACHO_ATIVOS: readonly EstadoDespacho[] = ["designada", "a_caminho", "em_execucao"];

/** Passos do ciclo (§9): designada → aceite (a caminho) → início (em execução) → conclusão. */
export type PassoDespacho = "aceite" | "inicio" | "conclusao";
export const PASSOS_DESPACHO: Record<PassoDespacho, { rotulo: string; deEstado: EstadoDespacho; deStatus: string; paraStatus: string }> = {
  aceite: { rotulo: "Aceitar (a caminho)", deEstado: "designada", deStatus: "Equipe designada", paraStatus: "A caminho" },
  inicio: { rotulo: "Iniciar atendimento", deEstado: "a_caminho", deStatus: "A caminho", paraStatus: "Em execução" },
  conclusao: { rotulo: "Concluir", deEstado: "em_execucao", deStatus: "Em execução", paraStatus: "Concluída" },
};

/** Próximo passo permitido para o status da OS (null = nenhum). */
export function proximoPasso(statusOS: string): PassoDespacho | null {
  return (Object.keys(PASSOS_DESPACHO) as PassoDespacho[]).find((p) => PASSOS_DESPACHO[p].deStatus === statusOS) ?? null;
}

export interface DespachoResumo {
  id: string;
  equipe: string;
  estado: EstadoDespacho;
  apoioIntermunicipal: boolean;
  apoioJustificativa: string | null;
  excecaoJustificativa: string | null;
  designadaEm: string;
  aCaminhoEm: string | null;
  emExecucaoEm: string | null;
  concluidaEm: string | null;
  removidaEm: string | null;
  removidaMotivo: string | null;
  /** base da equipe (para "Rota a partir da base"); null se não cadastrada */
  equipeLat: number | null;
  equipeLng: number | null;
}

export interface EventoOS {
  id: number;
  tipo: string;
  de: string | null;
  para: string | null;
  motivo: string | null;
  /** equipe envolvida (designação, aceite, início, conclusão, remoção) */
  equipe: string | null;
  /** nome de quem fez; null se desconhecido */
  usuario: string | null;
  em: string;
}

// ───────── Recomendação de equipes (§9) ─────────

export interface EquipeCandidata {
  id: string;
  cidade: string;
  capacidade: number;
  qualificacoes: string[];
  lat: number | null;
  lng: number | null;
  /** despachos ativos da equipe agora */
  carga: number;
}

export interface OSParaDespacho {
  cidade: string;
  lat: number | null;
  lng: number | null;
  exigeQualificacao: string | null;
}

export interface Recomendacao {
  equipe: string;
  cidade: string;
  carga: number;
  capacidade: number;
  compativel: boolean;
  /** por que é incompatível (vazio se compatível) */
  motivosIncompatibilidade: string[];
  /** carga < capacidade; indisponível NUNCA pode ser designada, nem com exceção */
  disponivel: boolean;
  apoioIntermunicipal: boolean;
  /** metros em linha reta (haversine); null se faltar coordenada. Sem tempo estimado. */
  distanciaM: number | null;
  /** base da equipe (origem da rota no Maps); null se não cadastrada */
  base: PontoMapa | null;
  /** incompatível exige exceção autorizada + justificativa */
  exigeExcecao: boolean;
  /** apoio intermunicipal exige justificativa */
  exigeJustificativaApoio: boolean;
}

const tem = (n: number | null): n is number => typeof n === "number" && Number.isFinite(n);

export function avaliarEquipe(os: OSParaDespacho, e: EquipeCandidata): Recomendacao {
  const motivos: string[] = [];
  if (os.exigeQualificacao && !e.qualificacoes.includes(os.exigeQualificacao)) {
    motivos.push(`sem a qualificação "${os.exigeQualificacao}"`);
  }
  const apoio = e.cidade !== os.cidade;
  const dist = tem(os.lat) && tem(os.lng) && tem(e.lat) && tem(e.lng) ? Math.round(distanciaM({ lat: os.lat, lng: os.lng }, { lat: e.lat, lng: e.lng })) : null;
  return {
    equipe: e.id, cidade: e.cidade, carga: e.carga, capacidade: e.capacidade,
    compativel: motivos.length === 0, motivosIncompatibilidade: motivos,
    disponivel: e.carga < e.capacidade,
    apoioIntermunicipal: apoio, distanciaM: dist,
    base: tem(e.lat) && tem(e.lng) ? { lat: e.lat, lng: e.lng } : null,
    exigeExcecao: motivos.length > 0, exigeJustificativaApoio: apoio,
  };
}

/**
 * Ordena por compatibilidade e disponibilidade ANTES da distância. Equipes do município da OS por padrão;
 * de outra cidade só com `incluirApoio` (apoio intermunicipal), sempre depois das da própria cidade
 * em igualdade de compatibilidade/disponibilidade. Sem distância conhecida, vai para o fim do grupo.
 */
export function recomendarEquipes(os: OSParaDespacho, equipes: EquipeCandidata[], opts: { incluirApoio?: boolean } = {}): Recomendacao[] {
  return equipes
    .filter((e) => opts.incluirApoio || e.cidade === os.cidade)
    .map((e) => avaliarEquipe(os, e))
    .sort(
      (a, b) =>
        Number(b.compativel) - Number(a.compativel) ||
        Number(b.disponivel) - Number(a.disponivel) ||
        Number(a.apoioIntermunicipal) - Number(b.apoioIntermunicipal) ||
        (a.distanciaM ?? Infinity) - (b.distanciaM ?? Infinity) ||
        a.equipe.localeCompare(b.equipe),
    );
}

// ───────── Link do Google Maps (equivale ao mapsUrl do protótipo) ─────────

export interface PontoMapa { lat: number; lng: number }

/** Rota do Maps: `destino` por coordenadas ou, sem elas, por endereço (localização aproximada). */
export function urlMapas(destino: PontoMapa | string, origem?: PontoMapa | null): string {
  const p = (x: PontoMapa) => `${x.lat},${x.lng}`;
  const dest = typeof destino === "string" ? destino : p(destino);
  return (
    "https://www.google.com/maps/dir/?api=1" +
    (origem ? `&origin=${encodeURIComponent(p(origem))}` : "") +
    `&destination=${encodeURIComponent(dest)}&travelmode=driving`
  );
}
