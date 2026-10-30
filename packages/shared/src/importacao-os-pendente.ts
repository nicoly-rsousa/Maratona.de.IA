// Cadastro de OS no formato da planilha "OS manutenção pendente" (CSV principal; XLSX entra como a mesma `Tabela`).
// Funções PURAS (sem I/O, sem dependências): a conversão UTM→graus é INJETADA; região, textos nulos e padrão de poste vêm da configuração.
//
// Regras (docs/requisitos e pedido do usuário):
//  1. Obrigatórios: só o número da OS (OSNumero) e o município (extraído da Localidade). Todo o resto é opcional.
//  2. Vazio vira NULL, nunca zero nem texto de preenchimento. Só células vazias ou só com espaços são vazias; a lista de textos nulos
//     ("N/A", "-") é configurável e vem DESLIGADA por padrão.
//  3. Coordenadas opcionais; UTM exige X e Y juntos (só um → aviso e coordenada nula). Sem coordenada a OS entra sinalizada.
//  4. Endereço opcional: vazio vira "Poste <código> — <município>" (do Complemento) ou "Endereço não informado — <município>"; a origem é registrada.
//  5. Valor PRESENTE e inválido em campo opcional: a linha entra com AVISO e o campo fica nulo. Nada é corrigido em silêncio.
//  6. Sem número ou sem município: linha rejeitada (vai para o arquivo de rejeitadas, sem dado pessoal).

export type Celula = string | number | boolean | Date | null | undefined;

/** Tabela já lida (de CSV ou de XLSX). `linha` é a linha física do arquivo (cabeçalho = 1). */
export interface Tabela {
  cabecalho: string[];
  linhas: { linha: number; valores: Celula[] }[];
}

/** Colunas que o cadastro reconhece, com o nome EXATO da planilha real. As demais (95 no total) são ignoradas. */
export const CAMPOS_OS_PENDENTE = {
  numero: "OSNumero",
  setor: "CodSetor",
  prioridade: "CodPrioridade",
  prazo: "DataDeadline",
  clientes: "Quantidade clientes",
  localidade: "Localidade",
  logradouro: "Logradouro",
  bairro: "Bairro",
  complemento: "Complemento de Localização",
  utmX: "COORDENADA UTM X",
  utmY: "COORDENADA UTM Y",
  lat: "LATITUDE (Y) - SIRGAS 2000",
  lng: "LONGITUDE (X) - SIRGAS 2000",
  esquema: "DescEsquema",
  familia: "Familias",
} as const;
export type CampoOS = keyof typeof CAMPOS_OS_PENDENTE;
const CAMPOS = Object.keys(CAMPOS_OS_PENDENTE) as CampoOS[];

/** Colunas que podem ir para o arquivo de rejeitadas: SEM Logradouro, Bairro e Complemento (podem conter dado pessoal). */
export const CAMPOS_DAS_REJEITADAS: readonly CampoOS[] = [
  "numero", "setor", "prioridade", "prazo", "clientes", "localidade", "esquema", "familia", "utmX", "utmY", "lat", "lng",
];

export interface ConfigImportacaoOS {
  /** textos que contam como vazio (comparação sem caixa); [] = desligado (padrão) */
  textosNulos: readonly string[];
  /** retângulo de coordenada válida; null = só confere o intervalo geográfico (-90..90, -180..180). O valor real vem de `configuracoes`. */
  regiao: { latMin: number; latMax: number; lngMin: number; lngMax: number } | null;
  /** expressão regular (texto) do que vale como código de poste no Complemento; o que não casar é texto livre e NÃO é copiado */
  padraoPoste: string;
  /** deslocamento aplicado às datas sem fuso (ex.: "-03:00") */
  fusoHorario: string;
  /** UTM (X, Y) → graus; null quando não converte. Injetado: o shared não tem dependências. */
  utmParaGraus: (x: number, y: number) => { lat: number; lng: number } | null;
}

/** Valores DEMONSTRATIVOS e configuráveis (nada disto é regra de negócio). `utmParaGraus` o chamador fornece. */
export const CONFIG_PADRAO_IMPORTACAO_OS: Omit<ConfigImportacaoOS, "utmParaGraus"> = {
  textosNulos: [],
  regiao: null,
  padraoPoste: "^[A-Za-z0-9./-]{1,20}$",
  fusoHorario: "-03:00",
};

export type CodigoAviso =
  | "prazo_invalido" | "clientes_invalido" | "coordenada_invalida" | "coordenada_fora_regiao" | "latlng_incompleto"
  | "utm_incompleto" | "utm_invalido" | "complemento_fora_do_formato" | "endereco_curto";

export interface Aviso { linha: number; campo: string; codigo: CodigoAviso; mensagem: string }

export type OrigemEndereco = "informado" | "derivado_poste" | "nao_informado";
export type OrigemGeoOS = "informado" | "convertido_utm" | "desconhecido";

export interface OSPendente {
  linha: number;
  numeroOrigem: string;
  municipio: string;
  setor: string | null;
  prioridadeLegada: string | null;
  /** DataDeadline; null = desconhecido */
  prazoOrigem: string | null;
  /** null = desconhecido (nunca 0 por falta de dado) */
  clientes: number | null;
  lat: number | null;
  lng: number | null;
  origemGeo: OrigemGeoOS;
  semCoordenada: boolean;
  /** sempre preenchido (a coluna do banco é NOT NULL) */
  endereco: string;
  origemEndereco: OrigemEndereco;
  posteCodigo: string | null;
  tipoServico: string | null;
  familiaAtivo: string | null;
  avisos: Aviso[];
}

export interface Rejeitada { linha: number; motivo: string; campos: Partial<Record<CampoOS, string | null>> }

export interface ResultadoImportacaoOS {
  /** não vazio = o arquivo inteiro foi recusado (falta coluna obrigatória) */
  erroEstrutural: string | null;
  totalLinhas: number;
  entram: OSPendente[];
  rejeitadas: Rejeitada[];
  comAviso: number;
  avisosPorCodigo: Partial<Record<CodigoAviso, number>>;
  semCoordenada: number;
  origemEndereco: Record<OrigemEndereco, number>;
  /** quantas linhas (de TODAS, inclusive rejeitadas) têm a coluna vazia, pelo nome canônico da coluna */
  vazios: Record<string, number>;
  colunasReconhecidas: Record<CampoOS, string | null>;
  /** nomes canônicos das colunas que não vieram no cabeçalho (tratadas como todas vazias) */
  colunasAusentes: string[];
}

// ───────── Leitura do CSV ─────────
export const normalizarCabecalho = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Decodifica os bytes do CSV: tenta UTF-8 estrito; se houver byte inválido, cai para Windows-1252 (CSV típico do Excel brasileiro). */
export function decodificarCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function detectarSeparador(primeiraLinha: string): string {
  let melhor = ";", max = -1;
  for (const sep of [";", ",", "\t"]) {
    let n = 0, aspas = false;
    for (const ch of primeiraLinha) { if (ch === '"') aspas = !aspas; else if (ch === sep && !aspas) n++; }
    if (n > max) { max = n; melhor = sep; }
  }
  return melhor;
}

/** CSV (RFC 4180: aspas, aspas escapadas, quebra de linha dentro de aspas) com separador `;`, `,` ou tab detectado no cabeçalho. */
export function lerTabelaCsv(texto: string): Tabela {
  const t = texto.replace(/^﻿/, "");
  const sep = detectarSeparador(t.split(/\r?\n/, 1)[0] ?? "");
  const registros: { linha: number; campos: string[] }[] = [];
  let campos: string[] = [], campo = "", aspas = false, linhaAtual = 1, inicio = 1, conteudo = false;
  const fecharCampo = () => { campos.push(campo); campo = ""; };
  const fecharRegistro = () => { fecharCampo(); registros.push({ linha: inicio, campos }); campos = []; conteudo = false; };
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (aspas) {
      if (ch === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; continue; }
      if (ch === "\n") linhaAtual++;
      campo += ch;
      continue;
    }
    if (ch === '"') { aspas = true; conteudo = true; continue; }
    if (ch === sep) { fecharCampo(); conteudo = true; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") {
      if (conteudo || campo !== "" || campos.length > 0) fecharRegistro();
      linhaAtual++;
      inicio = linhaAtual;
      continue;
    }
    campo += ch;
    conteudo = true;
  }
  if (campo !== "" || campos.length > 0 || conteudo) fecharRegistro();

  const emBranco = (r: { campos: string[] }) => r.campos.length === 1 && r.campos[0]!.trim() === "";
  const [cab, ...resto] = registros;
  if (!cab) return { cabecalho: [], linhas: [] };
  return {
    cabecalho: cab.campos.map((c) => c.trim()),
    linhas: resto.filter((r) => !emBranco(r)).map((r) => ({ linha: r.linha, valores: r.campos })),
  };
}

// ───────── Conversões de valor (cada uma devolve valor ou "inválido", nunca um valor "corrigido") ─────────
const diasDoMes = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();
const dois = (n: number) => String(n).padStart(2, "0");

function montarData(a: number, mo: number, d: number, h: number, mi: number, s: number, fuso: string): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > diasDoMes(a, mo) || h < 0 || h > 23 || mi < 0 || mi > 59 || s < 0 || s > 59) return null;
  return `${String(a).padStart(4, "0")}-${dois(mo)}-${dois(d)}T${dois(h)}:${dois(mi)}:${dois(s)}${fuso}`;
}

function dataDeUtc(d: Date, fuso: string): string | null {
  if (Number.isNaN(d.getTime())) return null;
  return montarData(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), fuso);
}

/** string "dd/mm/aaaa [hh:mm[:ss]]" ou "aaaa-mm-dd[ T]hh:mm[:ss]", Date (XLSX) ou serial do Excel. null = inválida. */
function lerPrazo(c: Celula, texto: string, fuso: string): string | null {
  if (c instanceof Date) return dataDeUtc(c, fuso);
  if (typeof c === "number") {
    if (!Number.isFinite(c) || c < 20_000 || c > 80_000) return null;
    return dataDeUtc(new Date(Date.UTC(1899, 11, 30) + Math.round(c * 86_400_000)), fuso);
  }
  let m = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(texto);
  if (m) return montarData(+m[3]!, +m[2]!, +m[1]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), fuso);
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(texto);
  if (m) return montarData(+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), fuso);
  return null;
}

function lerClientes(c: Celula, texto: string): number | null {
  if (typeof c === "number") return Number.isInteger(c) && c >= 0 ? c : null;
  if (/^\d+$/.test(texto)) { const n = Number(texto); return Number.isSafeInteger(n) ? n : null; }
  if (/^\d{1,3}([.,]\d{3})+$/.test(texto)) { const n = Number(texto.replace(/[.,]/g, "")); return Number.isSafeInteger(n) ? n : null; }
  return null;
}

function lerDecimal(c: Celula, texto: string): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  return /^-?\d+([.,]\d+)?$/.test(texto) ? Number(texto.replace(",", ".")) : null;
}

// ───────── Projeção (privacidade) ─────────
/** Índices (no cabeçalho original) da primeira ocorrência de cada coluna reconhecida, na ordem canônica. */
function indicesReconhecidos(cabecalho: readonly string[]): { campo: CampoOS; i: number }[] {
  const norm = cabecalho.map(normalizarCabecalho);
  return CAMPOS.map((campo) => ({ campo, i: norm.indexOf(normalizarCabecalho(CAMPOS_OS_PENDENTE[campo])) })).filter((x) => x.i >= 0);
}

/**
 * Mantém só as colunas reconhecidas, com o nome canônico e na ordem canônica. As demais (a planilha real tem 95 colunas, várias
 * podem ter dado pessoal) NUNCA saem do navegador. A linha física de cada registro é preservada.
 */
export function projetarTabela(t: Tabela): Tabela {
  const usadas = indicesReconhecidos(t.cabecalho);
  return {
    cabecalho: usadas.map((x) => CAMPOS_OS_PENDENTE[x.campo]),
    linhas: t.linhas.map((l) => ({ linha: l.linha, valores: usadas.map((x) => l.valores[x.i]) })),
  };
}

/** Nomes das colunas do arquivo que NÃO são usadas (inclui repetições): o que não sai do computador do usuário. */
export function colunasIgnoradas(t: Tabela): string[] {
  const usados = new Set(indicesReconhecidos(t.cabecalho).map((x) => x.i));
  return t.cabecalho.filter((_, i) => !usados.has(i));
}

// ───────── Análise ─────────
const TEXTO_VAZIO_PADRAO = "";

export function analisarOSPendentes(tabela: Tabela, cfg: ConfigImportacaoOS): ResultadoImportacaoOS {
  const padraoPoste = new RegExp(cfg.padraoPoste);
  const nulos = new Set(cfg.textosNulos.map((t) => t.trim().toLowerCase()));

  // primeira ocorrência de cada coluna (a planilha real repete cabeçalhos)
  const indice: Partial<Record<CampoOS, number>> = {};
  const normalizados = tabela.cabecalho.map(normalizarCabecalho);
  const colunasReconhecidas = {} as Record<CampoOS, string | null>;
  const colunasAusentes: string[] = [];
  for (const campo of CAMPOS) {
    const i = normalizados.indexOf(normalizarCabecalho(CAMPOS_OS_PENDENTE[campo]));
    if (i >= 0) { indice[campo] = i; colunasReconhecidas[campo] = tabela.cabecalho[i]!; }
    else { colunasReconhecidas[campo] = null; colunasAusentes.push(CAMPOS_OS_PENDENTE[campo]); }
  }

  const vazio = (): ResultadoImportacaoOS => ({
    erroEstrutural: null, totalLinhas: tabela.linhas.length, entram: [], rejeitadas: [], comAviso: 0, avisosPorCodigo: {}, semCoordenada: 0,
    origemEndereco: { informado: 0, derivado_poste: 0, nao_informado: 0 },
    vazios: Object.fromEntries(CAMPOS.map((c) => [CAMPOS_OS_PENDENTE[c], 0])), colunasReconhecidas, colunasAusentes,
  });
  const r = vazio();

  const faltam = (["numero", "localidade"] as const).filter((c) => indice[c] === undefined).map((c) => CAMPOS_OS_PENDENTE[c]);
  if (faltam.length) {
    r.erroEstrutural = `O cabeçalho não tem ${faltam.length > 1 ? "as colunas obrigatórias" : "a coluna obrigatória"} ${faltam.join(" e ")}.`;
    return r;
  }

  const primeiraLinhaDoNumero = new Map<string, number>();

  for (const lin of tabela.linhas) {
    const celula = (campo: CampoOS): Celula => (indice[campo] === undefined ? undefined : lin.valores[indice[campo]!]);
    /** texto aparado; vazio, só espaços e (se ligados) textos nulos → null */
    const texto = (campo: CampoOS): string | null => {
      const c = celula(campo);
      if (c === null || c === undefined) return null;
      const s = (c instanceof Date ? c.toISOString() : String(c)).trim();
      return s === TEXTO_VAZIO_PADRAO || nulos.has(s.toLowerCase()) ? null : s;
    };
    const t = Object.fromEntries(CAMPOS.map((c) => [c, texto(c)])) as Record<CampoOS, string | null>;
    for (const c of CAMPOS) if (t[c] === null) r.vazios[CAMPOS_OS_PENDENTE[c]]! += 1;

    const numero = t.numero;
    const municipio = t.localidade === null ? "" : t.localidade.replace(/(^|\s+)\d+-\d+$/, "").replace(/\s+/g, " ").trim();

    let motivo: string | null = null;
    if (numero === null && municipio === "") motivo = "sem número da OS e sem município";
    else if (numero === null) motivo = "sem número da OS";
    else if (municipio === "") motivo = "sem município (Localidade vazia ou só com o código final)";
    else if (primeiraLinhaDoNumero.has(numero)) motivo = `número da OS repetido no arquivo (primeira ocorrência na linha ${primeiraLinhaDoNumero.get(numero)})`;
    if (motivo !== null || numero === null) {
      r.rejeitadas.push({ linha: lin.linha, motivo: motivo!, campos: Object.fromEntries(CAMPOS_DAS_REJEITADAS.map((c) => [c, t[c]])) });
      continue;
    }
    primeiraLinhaDoNumero.set(numero, lin.linha);

    const avisos: Aviso[] = [];
    const avisar = (campo: string, codigo: CodigoAviso, mensagem: string) => avisos.push({ linha: lin.linha, campo, codigo, mensagem });
    const nome = (c: CampoOS) => CAMPOS_OS_PENDENTE[c];

    // prazo (DataDeadline): vazio = desconhecido (sem aviso); presente e inválido = aviso, campo nulo
    let prazoOrigem: string | null = null;
    if (t.prazo !== null) {
      prazoOrigem = lerPrazo(celula("prazo"), t.prazo, cfg.fusoHorario);
      if (prazoOrigem === null) avisar(nome("prazo"), "prazo_invalido", `${nome("prazo")}: "${t.prazo}" não é uma data válida; campo deixado vazio.`);
    }

    // clientes
    let clientes: number | null = null;
    if (t.clientes !== null) {
      clientes = lerClientes(celula("clientes"), t.clientes);
      if (clientes === null) avisar(nome("clientes"), "clientes_invalido", `${nome("clientes")}: "${t.clientes}" não é uma quantidade válida; campo deixado vazio.`);
    }

    // coordenadas
    const dentro = (la: number, lo: number) =>
      cfg.regiao ? la >= cfg.regiao.latMin && la <= cfg.regiao.latMax && lo >= cfg.regiao.lngMin && lo <= cfg.regiao.lngMax
        : Math.abs(la) <= 90 && Math.abs(lo) <= 180;
    let lat: number | null = null, lng: number | null = null, origemGeo: OrigemGeoOS = "desconhecido";
    const nomeLatLng = `${nome("lat")} / ${nome("lng")}`;
    if (t.lat !== null && t.lng !== null) {
      const la = lerDecimal(celula("lat"), t.lat), lo = lerDecimal(celula("lng"), t.lng);
      if (la === null || lo === null) avisar(nomeLatLng, "coordenada_invalida", `${nomeLatLng}: valores não numéricos; coordenada deixada vazia.`);
      else if (!dentro(la, lo)) avisar(nomeLatLng, "coordenada_fora_regiao", `${nomeLatLng}: coordenada fora da região configurada; descartada.`);
      else { lat = la; lng = lo; origemGeo = "informado"; }
    } else if ((t.lat === null) !== (t.lng === null)) {
      avisar(nomeLatLng, "latlng_incompleto", `${nomeLatLng}: veio só uma das duas; a coordenada não foi usada.`);
    }
    if (lat === null) {
      const nomeUtm = `${nome("utmX")} / ${nome("utmY")}`;
      if (t.utmX !== null && t.utmY !== null) {
        const x = lerDecimal(celula("utmX"), t.utmX), y = lerDecimal(celula("utmY"), t.utmY);
        const g = x === null || y === null || x === 0 || y === 0 ? null : cfg.utmParaGraus(x, y);
        if (!g || !Number.isFinite(g.lat) || !Number.isFinite(g.lng)) avisar(nomeUtm, "utm_invalido", `${nomeUtm}: valores inválidos; coordenada deixada vazia.`);
        else if (!dentro(g.lat, g.lng)) avisar(nomeUtm, "coordenada_fora_regiao", `${nomeUtm}: coordenada convertida fora da região configurada; descartada.`);
        else { lat = g.lat; lng = g.lng; origemGeo = "convertido_utm"; }
      } else if ((t.utmX === null) !== (t.utmY === null)) {
        avisar(nomeUtm, "utm_incompleto", `${nomeUtm}: a UTM exige X e Y juntos; veio só ${t.utmX === null ? "Y" : "X"}. Coordenada deixada vazia.`);
      }
    }

    // endereço (a coluna do banco é NOT NULL: nunca fica vazio)
    let posteCodigo: string | null = null;
    if (t.complemento !== null) {
      if (padraoPoste.test(t.complemento)) posteCodigo = t.complemento;
      // não ecoa o texto: o complemento livre pode conter dado pessoal e NUNCA é copiado
      else avisar(nome("complemento"), "complemento_fora_do_formato", `${nome("complemento")} fora do formato de código de poste; ignorado (texto livre não é copiado).`);
    }
    let endereco = [t.logradouro, t.bairro].filter((x): x is string => x !== null).join(", ");
    let origemEndereco: OrigemEndereco = "informado";
    if (endereco !== "" && endereco.length < 3) {
      avisar(`${nome("logradouro")} / ${nome("bairro")}`, "endereco_curto", "Logradouro/Bairro com menos de 3 caracteres; tratado como não informado.");
      endereco = "";
    }
    if (endereco === "") {
      if (posteCodigo !== null) { endereco = `Poste ${posteCodigo} — ${municipio}`; origemEndereco = "derivado_poste"; }
      else { endereco = `Endereço não informado — ${municipio}`; origemEndereco = "nao_informado"; }
    }

    const os: OSPendente = {
      linha: lin.linha, numeroOrigem: numero, municipio, setor: t.setor, prioridadeLegada: t.prioridade, prazoOrigem, clientes,
      lat, lng, origemGeo, semCoordenada: lat === null, endereco, origemEndereco, posteCodigo,
      tipoServico: t.esquema, familiaAtivo: t.familia, avisos,
    };
    r.entram.push(os);
    r.origemEndereco[origemEndereco]++;
    if (os.semCoordenada) r.semCoordenada++;
    if (avisos.length) r.comAviso++;
    for (const a of avisos) r.avisosPorCodigo[a.codigo] = (r.avisosPorCodigo[a.codigo] ?? 0) + 1;
  }
  return r;
}

// ───────── Arquivo de rejeitadas (sem dado pessoal) ─────────
function celulaCsv(v: string | null | undefined, sep: string): string {
  let s = v ?? "";
  // proteção contra injeção de fórmula no Excel; números negativos legítimos ("-21,1") não são mexidos
  if (/^[=+@\t\r]/.test(s) || /^-(?![\d.,])/.test(s)) s = `'${s}`;
  return /["\r\n]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV (separador `;`) das linhas rejeitadas: número da linha, motivo e SÓ as colunas permitidas. O BOM fica por conta de quem baixa. */
export function csvDeRejeitadas(rejeitadas: readonly Rejeitada[], separador = ";"): string {
  const cab = ["linha", "motivo", ...CAMPOS_DAS_REJEITADAS.map((c) => CAMPOS_OS_PENDENTE[c])];
  const linhas = rejeitadas.map((x) =>
    [String(x.linha), x.motivo, ...CAMPOS_DAS_REJEITADAS.map((c) => x.campos[c] ?? "")].map((v) => celulaCsv(v, separador)).join(separador));
  return [cab.map((v) => celulaCsv(v, separador)).join(separador), ...linhas].join("\n") + "\n";
}

// ───────── Lotes ─────────
/** Divide em lotes (padrão 200, como pedido). A gravação é idempotente pela chave `numeroOrigem`. */
export function lotes<T>(itens: readonly T[], tamanho = 200): T[][] {
  if (!Number.isInteger(tamanho) || tamanho < 1) throw new Error("Tamanho de lote inválido.");
  const saida: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) saida.push(itens.slice(i, i + tamanho));
  return saida;
}
