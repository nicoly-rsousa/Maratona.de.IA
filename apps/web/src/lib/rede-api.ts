import { api, apiPost } from "./api";

// Tipos e cliente das rotas /rede/* (apps/api/src/routes/rede.ts). O front fala SÓ com a API, nunca direto com o Supabase.
// Desconhecido é `null`, nunca 0. A regra de perfil (hoje só o Administrador) é da API: 403 para os demais.

export interface RedeConfig { raioPadraoM: number; raioMaxM: number; pode_sugerir: boolean }

export interface CircuitoResumo {
  codigo: string;
  tem_tracado: boolean;
  chaves_qtd: number | null;
  clientes_total: number | null;
  clientes_ligados: number | null;
  clientes_desligados: number | null;
  qtd_os: number;
  bbox: { min_lat: number; min_lng: number; max_lat: number; max_lng: number } | null;
}
export interface RespostaCircuitos { total: number; circuitos: CircuitoResumo[] }

/** circuito_origem = "nao_identificado": o código da OS não existe nas bases de rede (nunca é corrigido automaticamente). */
export type CircuitoOrigem = "importado" | "nao_identificado" | "informado" | "confirmado";

export interface OSRedeLeve {
  numero: string;
  circuito: string | null;
  circuito_origem: CircuitoOrigem | null;
  lat: number | null;
  lng: number | null;
  municipio: string | null;
  prioridade_legada: string | null;
  /** 0–4 pelo mapa de configuracoes; null = SEM MAPA (≠ 0) */
  prioridade_codigo: number | null;
  prazo: string | null;
  tipo_servico: string | null;
}
export interface RespostaOS {
  importado_em: string | null;
  total: number;
  filtro_regional: { configurada: boolean; aplicado: boolean };
  os: OSRedeLeve[];
}

export interface RegionalMunicipio { municipio: string; regional: string | null }
export interface RespostaRegionais { configurada: boolean; regionais: string[]; municipios: RegionalMunicipio[] }

export interface DetalheCircuito {
  circuito: {
    codigo: string; clientes: number | null; ligados: number | null; desligados: number | null; classes: Record<string, number> | null;
    chaves_qtd: number | null; tem_tracado: boolean;
    bbox_min_lat: number | null; bbox_min_lng: number | null; bbox_max_lat: number | null; bbox_max_lng: number | null;
  };
  /** a ordem das OS é INFORMATIVA (prioridade legada mapeada); não é a fila do Farol */
  ordem_informativa: true;
  aviso_ordem: string;
  os: (Omit<OSRedeLeve, "prazo"> & { prazo: string | null; clientes: number | null; familia_ativo: string | null; origem_geo: string | null })[];
}

export interface FeicaoLinha {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: { id: string; rede: string; uso: string | null; trecho: number | null; dono: string | null };
}
export interface Tracado { type: "FeatureCollection"; features: FeicaoLinha[] }

export interface FeicaoChave {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { tipo: string | null; tipo_unidade: string | null; numero_operativo: string | null };
}
export interface Chaves { type: "FeatureCollection"; features: FeicaoChave[] }

/** Sem posição (centroide exige ≥ 3 clientes georreferenciados): lat/lng nulos. Nunca se inventa posição. */
export interface TransformadorRede { transformador: string; clientes: number; ligados: number; lat: number | null; lng: number | null }

export interface OSProxima extends OSRedeLeve { distancia_m: number }
export interface RespostaProximas { origem: string; raio_m: number; ordem_informativa: true; aviso_ordem: string; os: OSProxima[] }

export interface CorpoSugestao { os_origem: string; os_sugerida: string; raio_m: number }
export interface SugestaoRegistrada { id: number; os_origem: string; os_sugerida: string; raio_m: number; criado_em: string }

const seg = encodeURIComponent; // códigos de circuito têm espaço ("CET-LUM 2") e números de OS têm "/": sempre codificados
const qs = (p: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const t = s.toString();
  return t ? `?${t}` : "";
};

export const redeApi = {
  config: () => api<RedeConfig>("/rede/config"),
  circuitos: () => api<RespostaCircuitos>("/rede/circuitos"),
  os: (f: { regional?: string; circuito?: string } = {}) => api<RespostaOS>(`/rede/os${qs(f)}`),
  regionais: () => api<RespostaRegionais>("/rede/regionais"),
  circuito: (codigo: string) => api<DetalheCircuito>(`/rede/circuitos/${seg(codigo)}`),
  /** média tensão por padrão; `baixaTensao` só quando o usuário liga a caixa (busca ?bt=1) */
  tracado: (codigo: string, baixaTensao = false) => api<Tracado>(`/rede/circuitos/${seg(codigo)}/tracado${qs({ bt: baixaTensao ? 1 : undefined })}`),
  chaves: (codigo: string) => api<Chaves>(`/rede/circuitos/${seg(codigo)}/chaves`),
  transformadores: (codigo: string) => api<TransformadorRede[]>(`/rede/circuitos/${seg(codigo)}/transformadores`),
  proximas: (numero: string, raioM?: number, regional?: string) =>
    api<RespostaProximas>(`/rede/os/${seg(numero)}/proximas${qs({ raio_m: raioM, regional })}`),
  /** só registra a sugestão; não designa equipe nem altera a fila */
  sugerir: (corpo: CorpoSugestao) => apiPost<SugestaoRegistrada>("/rede/sugestoes", corpo),
};

/** Chaves do TanStack Query: o que depende do circuito/raio entra na chave, então só o circuito selecionado é carregado. */
export const chavesRede = {
  config: ["rede", "config"] as const,
  circuitos: ["rede", "circuitos"] as const,
  regionais: ["rede", "regionais"] as const,
  os: (f: { regional?: string; circuito?: string } = {}) => ["rede", "os", f.regional ?? null, f.circuito ?? null] as const,
  circuito: (codigo: string) => ["rede", "circuito", codigo] as const,
  tracado: (codigo: string, bt: boolean) => ["rede", "circuito", codigo, "tracado", bt] as const,
  chaves: (codigo: string) => ["rede", "circuito", codigo, "chaves"] as const,
  transformadores: (codigo: string) => ["rede", "circuito", codigo, "transformadores"] as const,
  proximas: (numero: string, raioM: number, regional?: string) => ["rede", "proximas", numero, raioM, regional ?? null] as const,
};
