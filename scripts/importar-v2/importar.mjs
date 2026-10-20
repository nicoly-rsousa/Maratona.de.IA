// Importação Farol v2 (etapa 1): rede, regional e OS importadas, SOMENTE dados agregados.
//
// Uso:
//   node scripts/importar-v2/importar.mjs                 # modo de teste: lê tudo local, não abre conexão com o banco
//   node --env-file=.env.docker scripts/importar-v2/importar.mjs --gravar   # SÓ banco local (127.0.0.1/localhost, porta 54322)
// Opções: --dados <pasta> (padrão docs/dados)  --min-pontos-centroide <n> (padrão 3)
//
// Privacidade: o CSV de clientes é lido em streaming e cada registro é reduzido, ainda no parser,
// às colunas CIRCUITO, TRANSFORMADOR, SITUACAO, CLASSE, LAT, LONG. O restante nunca fica em memória.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  texto, decimalVirgula, quantidadeMilhar, utmParaGraus, dataBR, municipioDeLocalidade,
  wktPonto, distanciaM, emRegiao, assertCamposPermitidos, mediana, percentil, segmentosDoGeojson, destinoLocal,
} from './lib.mjs';

const require = createRequire(import.meta.url);
const { parse } = require('csv-parse');
const iconv = require('iconv-lite');
const ExcelJS = require('exceljs');

const args = process.argv.slice(2);
const opt = (nome, padrao) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : padrao;
};
const GRAVAR = args.includes('--gravar');
const SO_REGIONAL = args.includes('--atualizar-regional'); // só regional.csv → tabela regional (não toca no resto)
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DADOS = path.resolve(opt('--dados', path.join(RAIZ, 'docs/dados')));
const MIN_PONTOS_CENTROIDE = Number(opt('--min-pontos-centroide', '3'));
const MARGEM_BBOX = 0.1; // graus (dicionário, seção 7)

// Trava de gravação: ANTES de ler arquivos ou abrir qualquer conexão. Só destino local.
function exigirDestinoLocal() {
  const d = destinoLocal(process.env.DATABASE_URL);
  if (!d.ok) {
    console.error(`Gravação BLOQUEADA: ${d.motivo}. Este importador só grava em banco local (127.0.0.1 ou localhost, porta 54322). Nada foi lido nem gravado.`);
    process.exit(2);
  }
}
if (GRAVAR) exigirDestinoLocal();

const ARQ = {
  os: 'OS manutenção pendente.xlsx',
  chaves: 'FIS_EMG_2026_07_E_CHAVES_ID.csv',
  clientes: 'Clientes Maratona.csv',
  regional: 'regional.csv',
  tracado: 'tracado/*.geojson',
};

// A prioridade legada → Farol vem de configuracoes['rede.mapa_prioridade_legada'] (regra de ouro 1: nada embutido).
// Só é lida com --gravar (única hora em que há conexão); no modo de teste o relatório não classifica "sem mapa".
async function lerMapaPrioridade(sb) {
  const { data, error } = await sb.from('configuracoes').select('valor').eq('chave', 'rede.mapa_prioridade_legada').maybeSingle();
  if (error) throw new Error(`configuracoes: ${error.message}`);
  if (!data || typeof data.valor !== 'object' || data.valor === null) throw new Error('configuracoes: rede.mapa_prioridade_legada ausente ou inválido');
  return data.valor;
}

const rel = { modo: GRAVAR ? 'gravar' : 'teste', geradoEm: new Date().toISOString(), arquivos: {} };
const logf = (s) => console.error(s);

// ───────── 1. Base de chaves ─────────
async function lerChaves() {
  const arq = path.join(DADOS, ARQ.chaves);
  logf(`Lendo chaves: ${ARQ.chaves}`);
  const parser = fs.createReadStream(arq).pipe(iconv.decodeStream('latin1')).pipe(parse({
    delimiter: ';', columns: true, bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true,
  }));
  const chaves = [];
  const porCircuito = new Map();
  let lidas = 0, semGeo0 = 0, lat1Preenchida = 0, lat1Valida = 0, lat1Descartada = 0;
  const dist1 = [];
  for await (const r of parser) {
    lidas++;
    const circuito = texto(r.CIRCUITO);
    const lat0 = decimalVirgula(r.LAT_0), lng0 = decimalVirgula(r.LONG_0);
    const geo0 = emRegiao(lat0, lng0);
    if (!geo0) semGeo0++;
    const l1 = texto(r.LAT_1), g1 = texto(r.LONG_1);
    let geoFim = null;
    if (l1 !== null && g1 !== null) {
      lat1Preenchida++;
      const lat1 = decimalVirgula(l1), lng1 = decimalVirgula(g1);
      if (emRegiao(lat1, lng1)) {
        lat1Valida++;
        geoFim = wktPonto(lat1, lng1);
        if (geo0) dist1.push(distanciaM(lat0, lng0, lat1, lng1));
      } else lat1Descartada++;
    }
    chaves.push({
      circuito, conjunto: texto(r.CONJUNTO), tipo: texto(r.TIPO), tipo_unidade: texto(r.TIPOUNIDADE), id_ativo: texto(r.ID_ATIVO),
      numero_operativo: texto(r.NUMERO_OPERATIVO),
      geom: geo0 ? wktPonto(lat0, lng0) : null, geom_fim: geoFim,
    });
    if (circuito) {
      let c = porCircuito.get(circuito);
      if (!c) porCircuito.set(circuito, (c = { n: 0, minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 }));
      c.n++;
      if (geo0) {
        c.minLat = Math.min(c.minLat, lat0); c.maxLat = Math.max(c.maxLat, lat0);
        c.minLng = Math.min(c.minLng, lng0); c.maxLng = Math.max(c.maxLng, lng0);
      }
    }
  }
  rel.arquivos.chaves = { lidas };
  rel.chaves = {
    linhas: lidas, circuitos: porCircuito.size, sem_coordenada_valida: semGeo0,
    // Decide se dá para desenhar o traçado real do alimentador (RF05).
    lat1_long1: {
      preenchidas: lat1Preenchida, validas: lat1Valida, descartadas_fora_da_regiao: lat1Descartada,
      de_total: lidas,
      distancia_ponto0_ponto1_m: {
        mediana: mediana(dist1)?.toFixed(2), p95: percentil(dist1, 95)?.toFixed(2),
        max: dist1.length ? Math.max(...dist1).toFixed(2) : null,
        pct_acima_50m: dist1.length ? +(100 * dist1.filter((d) => d > 50).length / dist1.length).toFixed(2) : null,
      },
    },
  };
  return { chaves, porCircuito };
}

// ───────── 2. Clientes (agregado em streaming) ─────────
async function lerClientes() {
  const arq = path.join(DADOS, ARQ.clientes);
  logf(`Lendo clientes (streaming, só colunas permitidas): ${ARQ.clientes}`);
  const COLS = ['CIRCUITO', 'TRANSFORMADOR', 'SITUACAO', 'CLASSE', 'LAT', 'LONG'];
  let idx = null;
  const parser = fs.createReadStream(arq).pipe(iconv.decodeStream('latin1')).pipe(parse({
    delimiter: ';', bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true,
    // Projeção no parser: o registro completo (com nome, endereço etc.) é descartado aqui.
    on_record: (rec, ctx) => {
      if (ctx.lines === 1) {
        idx = COLS.map((c) => rec.indexOf(c));
        if (idx.includes(-1)) throw new Error('Cabeçalho do CSV de clientes sem as colunas esperadas');
        return null;
      }
      return idx.map((i) => rec[i]);
    },
  }));
  const circ = new Map(), trafo = new Map();
  const outrasSit = new Map();
  let lidas = 0, semCircuito = 0, semTrafo = 0, colunasErradas = 0;
  const novoAgg = () => ({ total: 0, lig: 0, des: 0, classes: {}, nGeo: 0, sLat: 0, sLng: 0 });
  for await (const [c, t, s, cl, la, lo] of parser) {
    lidas++;
    const circuito = texto(c);
    if (!circuito) { semCircuito++; continue; }
    const sit = texto(s), classe = (texto(cl) ?? 'desconhecida').toLowerCase();
    const lat = decimalVirgula(la), lng = decimalVirgula(lo);
    const geo = emRegiao(lat, lng);
    const aplica = (a) => {
      a.total++;
      if (sit === 'LIG') a.lig++; else if (sit === 'DES') a.des++;
      a.classes[classe] = (a.classes[classe] ?? 0) + 1;
      if (geo) { a.nGeo++; a.sLat += lat; a.sLng += lng; }
    };
    if (sit !== 'LIG' && sit !== 'DES') outrasSit.set(sit ?? '(vazio)', (outrasSit.get(sit ?? '(vazio)') ?? 0) + 1);
    let ac = circ.get(circuito); if (!ac) circ.set(circuito, (ac = novoAgg())); aplica(ac);
    const tr = texto(t);
    if (!tr) { semTrafo++; continue; }
    const k = `${circuito}\u0000${tr}`;
    let at = trafo.get(k); if (!at) trafo.set(k, (at = novoAgg())); aplica(at);
  }
  rel.arquivos.clientes = { lidas };
  rel.clientes = {
    linhas_lidas: lidas, circuitos: circ.size, transformadores: trafo.size,
    sem_circuito: semCircuito, sem_transformador: semTrafo, situacao_fora_de_LIG_DES: Object.fromEntries(outrasSit),
    colunas_erradas: colunasErradas,
  };
  return { circ, trafo };
}

// ───────── 3. Regional ─────────
async function lerRegional() {
  const arq = path.join(DADOS, ARQ.regional);
  const parser = fs.createReadStream(arq).pipe(parse({ columns: true, bom: true, skip_empty_lines: true }));
  const linhas = [];
  for await (const r of parser) {
    linhas.push({
      municipio: texto(r.municipio),
      regional: texto(r.regional), // vazia de propósito → null → filtro "não configurado"
      os_pendentes: quantidadeMilhar(r.os_pendentes),
    });
  }
  return linhas;
}

// ───────── 3b. Traçado dos alimentadores (GeoJSON) ─────────
function arquivosGeojson(dir) {
  const achados = [];
  if (!fs.existsSync(dir)) return achados;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) achados.push(...arquivosGeojson(p));
    else if (e.name.toLowerCase().endsWith('.geojson')) achados.push(p);
  }
  return achados.sort();
}

function lerTracado(circuitosChaves) {
  const arqs = arquivosGeojson(path.join(DADOS, 'tracado'));
  logf(`Lendo traçado: ${arqs.length} arquivo(s) GeoJSON`);
  const idsVistos = new Set();
  const rows = [];
  const porArquivo = {};
  const soma = {};
  for (const arq of arqs) {
    const circuito = path.basename(arq).replace(/\.geojson$/i, '');
    const { rows: r, q } = segmentosDoGeojson(JSON.parse(fs.readFileSync(arq, 'utf8')), circuito, idsVistos);
    rows.push(...r);
    porArquivo[circuito] = { lidos: q.lidos, validos: r.length };
    for (const [k, v] of Object.entries(q)) soma[k] = (soma[k] ?? 0) + v;
  }
  const porTrecho = {}, porRedeTrecho = {};
  for (const r of rows) {
    porTrecho[r.trecho] = (porTrecho[r.trecho] ?? 0) + 1;
    const k = `${r.rede}/${r.trecho}`; porRedeTrecho[k] = (porRedeTrecho[k] ?? 0) + 1;
  }
  const lidos = soma.lidos ?? 0;
  rel.arquivos.tracado = { lidas: lidos };
  rel.tracado = {
    arquivos: arqs.length, circuitos: Object.keys(porArquivo).sort(), segmentos_lidos: lidos, segmentos_validos: rows.length,
    // Conferência pedida: o que será gravado tem de ser igual ao que foi lido, sem id duplicado.
    lidos_igual_a_gravar: lidos === rows.length, rejeitados: Object.fromEntries(Object.entries(soma).filter(([k, v]) => k !== 'lidos' && v > 0)),
    por_trecho: porTrecho, por_rede_e_trecho: porRedeTrecho, ids_unicos: idsVistos.size,
    circuitos_sem_chaves_na_rede: Object.keys(porArquivo).filter((c) => !circuitosChaves.has(c)),
    por_arquivo: porArquivo,
  };
  return rows;
}

// ───────── 4. OS importadas ─────────
const cellTxt = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v.richText ? v.richText.map((p) => p.text).join('') : (v.result ?? v.text ?? null);
  return v;
};

async function lerOS(circuitosRede, bbox, mapaPrioridade) {
  const arq = path.join(DADOS, ARQ.os);
  logf(`Lendo OS: ${ARQ.os}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(arq);
  const ws = wb.worksheets[0];
  // Por nome do cabeçalho (com trim), nunca por posição. Só estas colunas são lidas.
  const pos = {};
  ws.getRow(1).eachCell((cell, i) => {
    const nome = String(cellTxt(cell.value) ?? '').trim();
    if (!(nome in pos)) pos[nome] = i; // 1ª ocorrência (há cabeçalhos duplicados)
  });
  const NEC = ['OSNumero', 'CodSetor', 'CodPrioridade', 'DataDeadline', 'Quantidade clientes', 'Localidade',
    'COORDENADA UTM X', 'COORDENADA UTM Y', 'LATITUDE (Y) - SIRGAS 2000', 'LONGITUDE (X) - SIRGAS 2000',
    'DescEsquema', 'Familias'];
  for (const n of NEC) if (!(n in pos)) throw new Error(`Coluna ausente na planilha de OS: ${n}`);

  const os = [];
  const numeros = new Set();
  const q = {
    lidas: 0, numero_duplicado: 0, circuito_nao_identificado: new Map(), circuito_vazio: [], sem_coordenada: [],
    utm_invalida: [], fora_bbox: [], prioridades_sem_mapa: new Map(), prioridades_vistas: new Map(),
    sem_municipio: 0, qtd_clientes_invalida: 0, prazo_invalido: 0,
  };
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const g = (n) => cellTxt(row.getCell(pos[n]).value);
    const numero = texto(g('OSNumero'));
    if (!numero) continue;
    q.lidas++;
    if (numeros.has(numero)) { q.numero_duplicado++; continue; }
    numeros.add(numero);

    const circuito = texto(g('CodSetor'));
    let circuito_origem = 'importado';
    if (!circuito) { circuito_origem = 'nao_identificado'; q.circuito_vazio.push(numero); }
    else if (!circuitosRede.has(circuito)) {
      circuito_origem = 'nao_identificado'; // NUNCA corrigido automaticamente
      const a = q.circuito_nao_identificado.get(circuito) ?? { os: 0, exemplos: [] };
      a.os++; if (a.exemplos.length < 5) a.exemplos.push(numero);
      q.circuito_nao_identificado.set(circuito, a);
    }

    // Coordenada: LATITUDE/LONGITUDE (graus) se preenchidas; senão UTM EPSG:31983 → graus.
    let lat = null, lng = null, origem_geo = 'desconhecido';
    const la = decimalVirgula(g('LATITUDE (Y) - SIRGAS 2000')), lo = decimalVirgula(g('LONGITUDE (X) - SIRGAS 2000'));
    if (emRegiao(la, lo)) { lat = la; lng = lo; origem_geo = 'informado'; }
    else {
      const x = texto(g('COORDENADA UTM X')), y = texto(g('COORDENADA UTM Y'));
      if (x === null || y === null) q.sem_coordenada.push(numero);
      else {
        const p = utmParaGraus(x, y);
        if (p && emRegiao(p.lat, p.lng)) { lat = p.lat; lng = p.lng; origem_geo = 'convertido_utm'; }
        else q.utm_invalida.push(numero);
      }
    }

    let fora_bbox = null;
    const b = circuito_origem === 'importado' ? bbox.get(circuito) : null;
    if (b && lat !== null) {
      fora_bbox = lat < b.minLat - MARGEM_BBOX || lat > b.maxLat + MARGEM_BBOX ||
        lng < b.minLng - MARGEM_BBOX || lng > b.maxLng + MARGEM_BBOX;
      if (fora_bbox) q.fora_bbox.push(numero);
    }

    const prio = texto(g('CodPrioridade'));
    q.prioridades_vistas.set(prio ?? '(vazio)', (q.prioridades_vistas.get(prio ?? '(vazio)') ?? 0) + 1);
    if (mapaPrioridade && (!prio || !Object.hasOwn(mapaPrioridade, prio))) q.prioridades_sem_mapa.set(prio ?? '(vazio)', (q.prioridades_sem_mapa.get(prio ?? '(vazio)') ?? 0) + 1);

    const municipio = municipioDeLocalidade(g('Localidade'));
    if (!municipio) q.sem_municipio++;
    const qtdTxt = texto(g('Quantidade clientes'));
    const clientes = quantidadeMilhar(qtdTxt);
    if (qtdTxt !== null && clientes === null) q.qtd_clientes_invalida++;
    const prazoTxt = texto(g('DataDeadline')); const prazo = dataBR(prazoTxt);
    if (prazoTxt !== null && prazo === null) q.prazo_invalido++;

    os.push({
      numero, circuito, circuito_origem, lat, lng, geom: wktPonto(lat, lng), municipio, origem_geo, fora_bbox,
      prioridade_legada: prio, prazo, clientes, tipo_servico: texto(g('DescEsquema')), familia_ativo: texto(g('Familias')),
    });
  }
  rel.arquivos.os = { lidas: q.lidas };
  return { os, q };
}

// ───────── Gravação (só com --gravar) ─────────
async function conectar() {
  const { createClient } = await import('@supabase/supabase-js');
  const databaseUrl = process.env.DATABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!databaseUrl || !key) throw new Error('Defina DATABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente local (ex.: node --env-file=.env.docker ...)');
  exigirDestinoLocal(); // defesa em profundidade: de novo, imediatamente antes de conectar
  const db = new URL(databaseUrl);
  // A API REST é derivada exclusivamente da URL PostgreSQL local validada.
  // Não há URL de API configurável, logo um endpoint remoto não pode ser usado para gravar.
  const url = `http://${db.hostname}:54321`;
  logf(`Destino da gravação (local): ${db.hostname}:54322`);
  return createClient(url, key, { auth: { persistSession: false } });
}

async function gravar(sb, { chaves, circuitosRows, trafoRows, regionalRows, osRows, tracadoRows }) {
  const lote = async (tabela, linhas, op) => {
    for (let i = 0; i < linhas.length; i += 1000) {
      const { error } = await op(sb.from(tabela), linhas.slice(i, i + 1000));
      if (error) throw new Error(`${tabela}: ${error.message}`);
    }
  };
  const { data: imp, error: e0 } = await sb.from('importacoes').insert({
    fonte: 'docs/dados (arquivos locais)', arquivo: Object.values(ARQ).join('; '),
    linhas_lidas: Object.values(rel.arquivos).reduce((s, a) => s + a.lidas, 0), linhas_gravadas: 0, relatorio: rel,
  }).select('id').single();
  if (e0) throw new Error(`importacoes: ${e0.message}`);
  const importacao_id = imp.id;
  const comImp = (rs) => rs.map((r) => ({ ...r, importacao_id }));

  // Cargas de rede são "atualização completa": limpa e regrava (não há chave natural nas chaves).
  const limpa = (t, col) => sb.from(t).delete().gte(col, 0);
  await limpa('rede_tracado', 'id');
  await limpa('rede_chaves', 'id');
  await limpa('rede_transformadores', 'id');
  await lote('circuitos', comImp(circuitosRows), (t, l) => t.upsert(l, { onConflict: 'codigo' }));
  await lote('rede_chaves', comImp(chaves), (t, l) => t.insert(l));
  await lote('rede_transformadores', comImp(trafoRows), (t, l) => t.insert(l));
  await lote('rede_tracado', comImp(tracadoRows), (t, l) => t.insert(l));
  // Conferência: linhas gravadas desta importação = linhas lidas (segmentos de traçado).
  const { count, error: ec } = await sb.from('rede_tracado').select('id', { count: 'exact', head: true }).eq('importacao_id', importacao_id);
  if (ec) throw new Error(`rede_tracado (conferência): ${ec.message}`);
  if (count !== rel.tracado.segmentos_lidos) throw new Error(`rede_tracado: gravados ${count} ≠ lidos ${rel.tracado.segmentos_lidos}`);
  // regional: não sobrescreve o que o administrador já preencheu.
  await lote('regional', regionalRows, (t, l) => t.upsert(l, { onConflict: 'municipio', ignoreDuplicates: true }));
  await sb.from('os_importadas').delete().neq('numero', '');
  await lote('os_importadas', comImp(osRows), (t, l) => t.insert(l));

  const gravadas = chaves.length + circuitosRows.length + trafoRows.length + regionalRows.length + osRows.length + tracadoRows.length;
  await sb.from('importacoes').update({ linhas_gravadas: gravadas }).eq('id', importacao_id);
  // Estatísticas atualizadas para o planner (busca por raio). O destino já foi validado como local em conectar().
  const { error: ea } = await sb.rpc('analisar_tabelas_rede');
  if (ea) throw new Error(`analisar_tabelas_rede: ${ea.message}`);
  return gravadas;
}

// ───────── Principal ─────────
if (SO_REGIONAL) {
  // regional.csv (editado pelo administrador) → tabela regional. O CSV é a fonte neste modo; nada mais é lido ou gravado.
  const rows = await lerRegional();
  assertCamposPermitidos('regional', rows);
  const r = { modo: GRAVAR ? 'atualizar-regional (gravar)' : 'atualizar-regional (teste)', municipios: rows.length,
    com_regional: rows.filter((x) => x.regional).length, sem_regional: rows.filter((x) => !x.regional).length };
  if (GRAVAR) {
    const sb = await conectar();
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('regional').upsert(rows.slice(i, i + 500).map((x) => ({ ...x, atualizado_em: new Date().toISOString() })), { onConflict: 'municipio' });
      if (error) throw new Error(`regional: ${error.message}`);
    }
  }
  console.log(JSON.stringify(r, null, 2));
  logf(GRAVAR ? 'Regional atualizada.' : 'Modo de teste: nada foi gravado.');
  process.exit(0);
}

const { chaves, porCircuito } = await lerChaves();
const tracadoRows = lerTracado(new Set(porCircuito.keys()));
const comTracado = new Set(tracadoRows.map((r) => r.circuito));
const { circ, trafo } = await lerClientes();
const regionalRows = await lerRegional();

const bbox = new Map([...porCircuito].filter(([, c]) => c.minLat <= c.maxLat));
const circuitosRede = new Set(porCircuito.keys()); // "rede" = base de chaves (dicionário, seção 5)
const sbGravar = GRAVAR ? await conectar() : null;
const mapaPrioridade = sbGravar ? await lerMapaPrioridade(sbGravar) : null;
const { os: osRows, q } = await lerOS(circuitosRede, bbox, mapaPrioridade);

// circuitos = união (chaves ∪ clientes); campos de cliente nulos quando o circuito não tem clientes na base.
const circuitosRows = [];
for (const cod of new Set([...porCircuito.keys(), ...circ.keys()])) {
  const b = porCircuito.get(cod), a = circ.get(cod);
  circuitosRows.push({
    codigo: cod,
    bbox_min_lat: b && b.minLat <= b.maxLat ? b.minLat : null, bbox_min_lng: b && b.minLat <= b.maxLat ? b.minLng : null,
    bbox_max_lat: b && b.minLat <= b.maxLat ? b.maxLat : null, bbox_max_lng: b && b.minLat <= b.maxLat ? b.maxLng : null,
    chaves_qtd: b ? b.n : null,
    clientes: a ? a.total : null, ligados: a ? a.lig : null, desligados: a ? a.des : null, classes: a ? a.classes : null,
    tem_tracado: comTracado.has(cod),
  });
}

// Transformadores: centroide só com >= MIN_PONTOS_CENTROIDE clientes georreferenciados (evita expor 1 endereço).
const trafoRows = [];
let trafoSemCoord = 0;
const distPontos = { '0': 0, '1': 0, '2': 0, '3_a_5': 0, '6_ou_mais': 0 };
for (const [k, a] of trafo) {
  const [circuito, transformador] = k.split('\u0000');
  const ok = a.nGeo >= MIN_PONTOS_CENTROIDE;
  distPontos[a.nGeo <= 2 ? String(a.nGeo) : a.nGeo <= 5 ? '3_a_5' : '6_ou_mais']++;
  if (!ok) trafoSemCoord++;
  trafoRows.push({
    circuito, transformador, clientes: a.total, ligados: a.lig, classes: a.classes, qtd_pontos_geo: a.nGeo,
    geom: ok ? wktPonto(a.sLat / a.nGeo, a.sLng / a.nGeo) : null,
  });
}

// Travas de privacidade antes de qualquer saída.
assertCamposPermitidos('circuitos', circuitosRows);
assertCamposPermitidos('rede_chaves', chaves);
assertCamposPermitidos('rede_tracado', tracadoRows);
assertCamposPermitidos('rede_transformadores', trafoRows);
assertCamposPermitidos('regional', regionalRows);
assertCamposPermitidos('os_importadas', osRows);

// Regional × municípios extraídos das OS
const munRegional = new Set(regionalRows.map((r) => r.municipio));
const munOS = new Map();
for (const o of osRows) if (o.municipio) munOS.set(o.municipio, (munOS.get(o.municipio) ?? 0) + 1);
const lista = (arr, n = 50) => ({ total: arr.length, primeiros: arr.slice(0, n) });
const cnt = (pred) => osRows.filter(pred).length;

const osPorCirc = new Map();
for (const o of osRows) if (o.circuito) osPorCirc.set(o.circuito, (osPorCirc.get(o.circuito) ?? 0) + 1);
rel.cobertura_tracado = {
  circuitos_com_tracado: comTracado.size,
  circuitos_com_os: osPorCirc.size,
  circuitos_com_os_e_tracado: [...comTracado].filter((c) => osPorCirc.has(c)).length,
  os_em_circuito_com_tracado: [...comTracado].reduce((n, c) => n + (osPorCirc.get(c) ?? 0), 0),
  os_total: osRows.length,
  nota: 'Circuitos sem traçado usam o contorno aproximado (envoltória das chaves), rotulado como tal.',
};
rel.regional = {
  municipios_no_arquivo: regionalRows.length,
  com_regional_preenchida: regionalRows.filter((r) => r.regional).length,
  filtro_por_regional: regionalRows.some((r) => r.regional) ? 'parcialmente configurado' : 'NÃO CONFIGURADO (todas vazias; OS continuam visíveis)',
  municipios_das_OS_fora_do_arquivo: [...munOS.keys()].filter((m) => !munRegional.has(m)),
  municipios_do_arquivo_sem_OS: [...munRegional].filter((m) => !munOS.has(m)),
};
rel.qualidade = {
  os_lidas: q.lidas,
  os_com_numero_duplicado_ignoradas: q.numero_duplicado,
  os_sem_circuito_conhecido: {
    total: cnt((o) => o.circuito_origem === 'nao_identificado'),
    codigos: [...q.circuito_nao_identificado].map(([codigo, v]) => ({
      codigo, os: v.os, existe_na_base_de_clientes: circ.has(codigo), exemplos: v.exemplos,
    })),
    os_com_circuito_vazio: lista(q.circuito_vazio),
  },
  os_sem_coordenada: { total: q.sem_coordenada.length + q.utm_invalida.length, utm_ausente: lista(q.sem_coordenada), utm_invalida_ou_fora_da_regiao: lista(q.utm_invalida) },
  os_por_origem_geo: Object.fromEntries(['informado', 'convertido_utm', 'derivado', 'desconhecido'].map((o) => [o, cnt((x) => x.origem_geo === o)])),
  os_fora_do_retangulo_do_circuito: { margem_graus: MARGEM_BBOX, ...lista(q.fora_bbox) },
  prioridade_legada: {
    valores_vistos: Object.fromEntries(q.prioridades_vistas),
    sem_mapa: mapaPrioridade ? Object.fromEntries(q.prioridades_sem_mapa) : 'não avaliado (modo de teste não abre conexão)',
    nota: 'Informativa. Decisão de migrar estas OS para a classificação do Farol está PENDENTE.',
  },
  transformadores: { total: trafoRows.length, sem_coordenada: trafoSemCoord, minimo_pontos_para_centroide: MIN_PONTOS_CENTROIDE, distribuicao_clientes_georreferenciados_por_transformador: distPontos },
  quantidade_clientes_invalida: q.qtd_clientes_invalida, prazo_invalido: q.prazo_invalido, os_sem_municipio: q.sem_municipio,
  circuitos_de_clientes_sem_chaves: [...circ.keys()].filter((c) => !porCircuito.has(c)).length,
  circuitos_de_chaves_sem_clientes: [...porCircuito.keys()].filter((c) => !circ.has(c)).length,
};
const linhas = (lidas, gravar) => ({ lidas, a_gravar: gravar });
rel.contagens = {
  circuitos: linhas(porCircuito.size + [...circ.keys()].filter((c) => !porCircuito.has(c)).length, circuitosRows.length),
  rede_chaves: linhas(rel.chaves.linhas, chaves.length),
  rede_transformadores: linhas(trafo.size, trafoRows.length),
  rede_tracado: linhas(rel.tracado.segmentos_lidos, tracadoRows.length),
  regional: linhas(regionalRows.length, regionalRows.length),
  os_importadas: linhas(q.lidas, osRows.length),
};

if (GRAVAR) {
  rel.gravadas = await gravar(sbGravar, { chaves, circuitosRows, trafoRows, regionalRows, osRows, tracadoRows });
  rel.modo = 'gravado';
}

const saida = path.join(DADOS, `relatorio-qualidade-${GRAVAR ? 'gravado' : 'teste'}.json`);
fs.writeFileSync(saida, JSON.stringify(rel, null, 2));
console.log(JSON.stringify(rel, null, 2));
logf(`\nRelatório salvo em ${saida} (ignorado pelo Git). ${GRAVAR ? 'GRAVADO no banco.' : 'Modo de teste: nada foi gravado.'}`);
