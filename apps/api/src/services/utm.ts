import proj4 from "proj4";

// SIRGAS 2000 / UTM zona 23S (EPSG:31983): a mesma definição do importador da rede. A planilha "OS manutenção pendente" é da
// região de Minas Gerais/Rio de Janeiro. A definição é explícita (não depende de registro externo).
proj4.defs("EPSG:31983", "+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs");

/** UTM (X, Y em metros) → graus (lat, lng); null se não converter para números finitos. */
export function utmParaGraus(x: number, y: number): { lat: number; lng: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const [lng, lat] = proj4("EPSG:31983", "EPSG:4326", [x, y]) as [number, number];
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}
