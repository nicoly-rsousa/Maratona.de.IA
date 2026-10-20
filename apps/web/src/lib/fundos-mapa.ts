// Fundos de mapa. Só o OpenStreetMap está implementado. Satélite NÃO está implementado de propósito: depende de decisão
// sobre provedor, chave e termos de uso. Para trocar o fundo depois, acrescente uma entrada em FUNDOS e mude FUNDO_PADRAO.
export interface FundoMapa {
  id: string;
  nome: string;
  /** modelo de URL de tiles (Leaflet) */
  url: string;
  /** HTML da atribuição exigida pelo provedor */
  atribuicao: string;
  zoomMax: number;
}

export const FUNDOS: Record<string, FundoMapa> = {
  osm: {
    id: "osm",
    nome: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    atribuicao: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    zoomMax: 19,
  },
};

export const FUNDO_PADRAO = "osm";
export const fundoAtual = (): FundoMapa => FUNDOS[FUNDO_PADRAO]!;
