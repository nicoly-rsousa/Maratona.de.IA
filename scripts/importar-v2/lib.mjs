// Funções puras da importação Farol v2 (sem I/O). Ver docs/dados/DICIONARIO-DADOS.md.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const proj4 = require('proj4');

// SIRGAS 2000 / UTM zona 23S, definida explicitamente (não depende de registro externo).
proj4.defs(
  'EPSG:31983',
  '+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
);

// Região da operação (Zona da Mata/MG e entorno), só para detectar coordenada absurda.
export const LIMITES_REGIAO = { latMin: -25, latMax: -17, lngMin: -46, lngMax: -38 };

export function emRegiao(lat, lng) {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= LIMITES_REGIAO.latMin && lat <= LIMITES_REGIAO.latMax &&
    lng >= LIMITES_REGIAO.lngMin && lng <= LIMITES_REGIAO.lngMax
  );
}

/** Texto limpo; vazio vira null. Códigos nunca passam por Number (zeros à esquerda). */
export function texto(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Decimal com vírgula ("-22,216944" ou "0,8085"). Não aceita milhar. */
export function decimalVirgula(v) {
  const s = texto(v);
  if (s === null) return null;
  if (!/^-?\d+([.,]\d+)?$/.test(s)) return null;
  return Number(s.replace(',', '.'));
}

/** "Quantidade clientes": a vírgula é milhar ("1,332" → 1332) [A CONFIRMAR com a operação]. */
export function quantidadeMilhar(v) {
  const s = texto(v);
  if (s === null) return null;
  if (/^\d+$/.test(s)) return Number(s);
  if (/^\d{1,3}(,\d{3})+$/.test(s)) return Number(s.replace(/,/g, ''));
  return null;
}

/** UTM (EPSG:31983) → graus (EPSG:4326). Aceita número com ponto decimal; retorna null se inválido. */
export function utmParaGraus(x, y) {
  const nx = typeof x === 'number' ? x : Number(String(x ?? '').trim().replace(',', '.'));
  const ny = typeof y === 'number' ? y : Number(String(y ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || nx === 0 || ny === 0) return null;
  const [lng, lat] = proj4('EPSG:31983', 'EPSG:4326', [nx, ny]);
  return { lat, lng };
}

/** "dd/mm/aaaa hh:mm:ss" em horário local de Brasília (UTC-3, sem horário de verão) → ISO. */
export function dataBR(v) {
  const s = texto(v);
  if (s === null) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) return null;
  const [, d, mo, a, h = '00', mi = '00', se = '00'] = m;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${a}-${mo}-${d}T${h}:${mi}:${se}-03:00`;
}

/** "MURIAE 48-160" → "MURIAE"; "MURY / NOVA FRIBURGO 257-1" → "MURY / NOVA FRIBURGO". */
export function municipioDeLocalidade(v) {
  const s = texto(v);
  if (s === null) return null;
  const m = s.replace(/\s+\d+-\d+$/, '').trim();
  return m === '' ? null : m;
}

export function wktPonto(lat, lng) {
  return lat === null || lng === null || lat === undefined || lng === undefined
    ? null
    : `SRID=4326;POINT(${lng} ${lat})`;
}

export function distanciaM(lat1, lng1, lat2, lng2) {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ───────── Privacidade: lista de permissão por tabela ─────────
export const CAMPOS_PERMITIDOS = {
  circuitos: ['codigo', 'bbox_min_lat', 'bbox_min_lng', 'bbox_max_lat', 'bbox_max_lng',
    'chaves_qtd', 'clientes', 'ligados', 'desligados', 'classes', 'tem_tracado', 'importacao_id'],
  rede_chaves: ['circuito', 'conjunto', 'tipo', 'tipo_unidade', 'id_ativo', 'numero_operativo', 'geom', 'geom_fim', 'importacao_id'],
  rede_tracado: ['circuito', 'id_segmento', 'rede', 'uso', 'trecho', 'dono', 'geom', 'importacao_id'],
  rede_transformadores: ['circuito', 'transformador', 'clientes', 'ligados', 'classes', 'qtd_pontos_geo', 'geom', 'importacao_id'],
  regional: ['municipio', 'regional', 'os_pendentes'],
  os_importadas: ['numero', 'circuito', 'circuito_origem', 'lat', 'lng', 'geom', 'municipio', 'origem_geo',
    'fora_bbox', 'prioridade_legada', 'prazo', 'clientes', 'tipo_servico', 'familia_ativo', 'importacao_id'],
};

// Nomes de colunas pessoais que jamais podem aparecer em um payload.
export const COLUNAS_PROIBIDAS = ['NOME', 'ENDERECO', 'BAIRRO', 'MEDIDOR', 'NUMCDC', 'NUM_CONTA', 'NUM_ROTA',
  'NUM_LIVRO', 'NUM_CASA', 'ID_PONTO_ENTREGA', 'ID_RAMAL', 'OBSERVACAO', 'INSPETOR', 'LOGRADOURO'];

/** Aborta se alguma linha tiver chave fora da lista da tabela. */
export function assertCamposPermitidos(tabela, linhas) {
  const ok = CAMPOS_PERMITIDOS[tabela];
  if (!ok) throw new Error(`Tabela sem lista de campos permitidos: ${tabela}`);
  for (const linha of linhas) {
    for (const k of Object.keys(linha)) {
      if (!ok.includes(k)) throw new Error(`Campo não permitido em ${tabela}: "${k}" (privacidade)`);
    }
  }
}

export function mediana(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
export function percentil(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

export function wktLinha(coords) {
  return `SRID=4326;LINESTRING(${coords.map(([lng, lat]) => `${lng} ${lat}`).join(',')})`;
}

/** Hosts e portas aceitos como "banco local" (Supabase local: API 54321, Postgres 54322). */
export const HOSTS_LOCAIS = ['127.0.0.1', 'localhost'];
export const PORTAS_LOCAIS = [54322];

/**
 * Trava de gravação: só aceita destino local. Analisa a URL com o parser padrão (não por trecho de texto),
 * então "localhost.supabase.co", "127.0.0.1.nip.io" e "http://localhost@host-remoto" são recusados.
 * Retorna { ok, motivo }; nunca abre conexão.
 */
export function destinoLocal(url, portas = PORTAS_LOCAIS) {
  if (typeof url !== 'string' || url.trim() === '') return { ok: false, motivo: 'URL de destino ausente' };
  let u;
  try { u = new URL(url.trim()); } catch { return { ok: false, motivo: 'URL de destino inválida' }; }
  if (!['http:', 'https:', 'postgres:', 'postgresql:'].includes(u.protocol)) return { ok: false, motivo: `protocolo não permitido (${u.protocol})` };
  if (!HOSTS_LOCAIS.includes(u.hostname)) return { ok: false, motivo: `host não é local (${u.hostname || 'vazio'})` };
  if (!portas.includes(Number(u.port))) return { ok: false, motivo: `porta não permitida (${u.port || 'padrão'}); use ${portas.join(' ou ')}` };
  return { ok: true, motivo: '' };
}

/**
 * Converte as features de UM arquivo de traçado em linhas de rede_tracado e valida:
 * geometria LineString dentro da região, alimentador = arquivo, trecho 1–4, rede MV/LV, id presente.
 * Ids duplicados (global, via `idsVistos`) são rejeitados e contados.
 */
export function segmentosDoGeojson(colecao, circuitoDoArquivo, idsVistos) {
  const rows = [];
  const q = { lidos: 0, geometria_invalida: 0, fora_da_regiao: 0, alimentador_diferente_do_arquivo: 0,
    trecho_invalido: 0, rede_invalida: 0, sem_id: 0, id_duplicado: 0 };
  for (const f of colecao?.features ?? []) {
    q.lidos++;
    const p = f.properties ?? {};
    const g = f.geometry;
    if (g?.type !== 'LineString' || !Array.isArray(g.coordinates) || g.coordinates.length < 2) { q.geometria_invalida++; continue; }
    if (!g.coordinates.every(([lng, lat]) => emRegiao(lat, lng))) { q.fora_da_regiao++; continue; }
    if (texto(p.alimentador) !== circuitoDoArquivo) { q.alimentador_diferente_do_arquivo++; continue; }
    const trecho = Number(p.trecho);
    if (!Number.isInteger(trecho) || trecho < 1 || trecho > 4) { q.trecho_invalido++; continue; }
    const rede = texto(p.rede);
    if (rede !== 'MV' && rede !== 'LV') { q.rede_invalida++; continue; }
    const id = texto(p.id);
    if (id === null) { q.sem_id++; continue; }
    if (idsVistos.has(id)) { q.id_duplicado++; continue; }
    idsVistos.add(id);
    rows.push({ circuito: circuitoDoArquivo, id_segmento: id, rede, uso: texto(p.uso), trecho, dono: texto(p.dono), geom: wktLinha(g.coordinates) });
  }
  return { rows, q };
}
