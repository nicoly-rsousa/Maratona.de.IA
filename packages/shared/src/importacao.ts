import { PARAMS_DUPLICIDADE_PADRAO, sugerirDuplicidade, type CandidataDuplicidade, type ParamsDuplicidade, type SugestaoDuplicidade } from "./duplicidade";
import { NovaOSSchema, TIPOS_MANUTENCAO, type NovaOS, type TipoManutencao } from "./solicitacao";

/** Uma linha do CSV depois de convertida e validada pelo mesmo schema do formulário (§11, "Nova solicitação"). */
export interface LinhaImportacaoValida {
  linha: number;
  status: "valida";
  dados: NovaOS;
  /** mesma checagem de duplicidade do formulário: nunca bloqueia sozinha, só avisa (§11). */
  duplicidade: SugestaoDuplicidade[];
}

/** Uma linha que não pôde virar uma OS: formato inválido ou campo obrigatório ausente. */
export interface LinhaImportacaoErro {
  linha: number;
  status: "erro";
  bruto: Record<string, string>;
  erros: string[];
}

export type LinhaImportacao = LinhaImportacaoValida | LinhaImportacaoErro;

export interface ResultadoImportacaoCsv {
  cabecalho: string[];
  linhas: LinhaImportacao[];
  totalLinhas: number;
  totalValidas: number;
  totalComDuplicidadeSuspeita: number;
  totalComErro: number;
}

/** Colunas que o importador reconhece (as demais, se vierem, são ignoradas). Só `cidade` e `endereco` são obrigatórias. */
export const COLUNAS_IMPORTACAO = [
  "cidade", "endereco", "lat", "lng", "transformador", "uc", "circuito", "conjunto", "exigeQualificacao", "tipo", "prazoH",
] as const;

interface RegistroCsv {
  /** linha 1-based no arquivo de origem onde o registro começa (útil para o usuário localizar o erro). */
  linha: number;
  campos: string[];
}

/**
 * Separa o texto em registros respeitando aspas RFC4180 (campo com vírgula, quebra de linha ou aspas
 * escapadas como ""). Cada registro guarda a linha onde começou no arquivo original.
 */
function dividirEmRegistros(texto: string): RegistroCsv[] {
  const registros: RegistroCsv[] = [];
  let campos: string[] = [];
  let campo = "";
  let dentroDeAspas = false;
  let linhaAtual = 1;
  let linhaInicioRegistro = 1;
  let registroTemConteudo = false;

  const fecharCampo = () => { campos.push(campo); campo = ""; };
  const fecharRegistro = () => {
    fecharCampo();
    registros.push({ linha: linhaInicioRegistro, campos });
    campos = [];
    registroTemConteudo = false;
  };

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (dentroDeAspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; continue; }
        dentroDeAspas = false;
        continue;
      }
      if (ch === "\n") linhaAtual++;
      campo += ch;
      continue;
    }
    if (ch === '"') { dentroDeAspas = true; registroTemConteudo = true; continue; }
    if (ch === ",") { fecharCampo(); registroTemConteudo = true; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") {
      if (registroTemConteudo || campo !== "" || campos.length > 0) fecharRegistro();
      linhaAtual++;
      linhaInicioRegistro = linhaAtual;
      continue;
    }
    campo += ch;
    registroTemConteudo = true;
  }
  if (campo !== "" || campos.length > 0 || registroTemConteudo) fecharRegistro();
  return registros;
}

/** Linha "em branco" de verdade: um único campo vazio (vírgulas sobrando ainda contam como dados). */
const linhaEmBranco = (campos: string[]) => campos.length === 1 && campos[0]!.trim() === "";

export function parseCsv(texto: string): { cabecalho: string[]; registros: { linha: number; campos: Record<string, string> }[] } {
  const semBom = texto.replace(/^﻿/, "");
  const registros = dividirEmRegistros(semBom);
  if (registros.length === 0) return { cabecalho: [], registros: [] };

  const [primeiro, ...resto] = registros;
  const cabecalho = primeiro!.campos.map((c) => c.trim());
  const linhas = resto
    .filter((r) => !linhaEmBranco(r.campos))
    .map((r) => ({
      linha: r.linha,
      campos: Object.fromEntries(cabecalho.map((nome, i) => [nome, (r.campos[i] ?? "").trim()])),
    }));
  return { cabecalho, registros: linhas };
}

function numeroOuErro(valor: string | undefined, campo: string, erros: string[]): number | undefined {
  const s = (valor ?? "").trim();
  if (s === "") return undefined;
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) { erros.push(`${campo}: "${s}" não é um número válido.`); return undefined; }
  return n;
}

const textoOuUndefined = (valor: string | undefined): string | undefined => {
  const s = (valor ?? "").trim();
  return s === "" ? undefined : s;
};

/** Converte uma linha bruta do CSV (texto) no formato que `NovaOSSchema` espera (números, enum). */
export function linhaParaCandidato(bruto: Record<string, string>): { dados: Record<string, unknown>; erros: string[] } {
  const erros: string[] = [];
  const lat = numeroOuErro(bruto.lat, "lat", erros);
  const lng = numeroOuErro(bruto.lng, "lng", erros);
  const prazoH = numeroOuErro(bruto.prazoH, "prazoH", erros);

  const tipoBruto = textoOuUndefined(bruto.tipo);
  const tipoValido = !!tipoBruto && (TIPOS_MANUTENCAO as readonly string[]).includes(tipoBruto);
  if (tipoBruto && !tipoValido) erros.push(`tipo: "${tipoBruto}" inválido (use ${TIPOS_MANUTENCAO.join(" ou ")}).`);

  const dados: Record<string, unknown> = {
    cidade: textoOuUndefined(bruto.cidade) ?? "",
    endereco: textoOuUndefined(bruto.endereco) ?? "",
    lat, lng,
    transformador: textoOuUndefined(bruto.transformador),
    uc: textoOuUndefined(bruto.uc),
    circuito: textoOuUndefined(bruto.circuito),
    conjunto: textoOuUndefined(bruto.conjunto),
    exigeQualificacao: textoOuUndefined(bruto.exigeQualificacao),
    tipo: tipoValido ? (tipoBruto as TipoManutencao) : undefined,
    prazoH: prazoH ?? null,
    fatos: {},
  };
  return { dados, erros };
}

/**
 * Processa um CSV de "Nova solicitação" em lote: cada linha passa pelo MESMO `NovaOSSchema` e pela
 * MESMA checagem de duplicidade (§11) do formulário — a diferença é só a origem dos dados.
 * Nada aqui cria OS: é só validação e sugestão, puras, sem I/O (regra de ouro nº1). Quem decide o que
 * vira OS de verdade é a pessoa, olhando esse resultado (duplicidade nunca é automática).
 * Uma linha também é checada contra as linhas válidas ANTERIORES do mesmo arquivo, para pegar
 * duplicidade dentro do próprio lote (ex.: a mesma pane relatada duas vezes na planilha).
 */
export function processarImportacaoCsv(
  texto: string,
  candidatasExistentes: CandidataDuplicidade[],
  agoraMs: number,
  params: ParamsDuplicidade = PARAMS_DUPLICIDADE_PADRAO,
  /** quando informado, toda linha usa esta cidade (o import é feito "para" uma cidade escolhida na tela, §13: o filtro de cidade é sempre do servidor). */
  cidadeFixa?: string,
): ResultadoImportacaoCsv {
  const { cabecalho, registros } = parseCsv(texto);
  const candidatasAcumuladas = [...candidatasExistentes];

  const linhas: LinhaImportacao[] = registros.map((reg) => {
    const campos = cidadeFixa ? { ...reg.campos, cidade: cidadeFixa } : reg.campos;
    const { dados: candidato, erros: errosConversao } = linhaParaCandidato(campos);
    if (errosConversao.length) return { linha: reg.linha, status: "erro", bruto: reg.campos, erros: errosConversao };

    const parsed = NovaOSSchema.safeParse(candidato);
    if (!parsed.success) {
      return {
        linha: reg.linha, status: "erro", bruto: reg.campos,
        erros: parsed.error.issues.map((i) => (i.path.length ? `${String(i.path[0])}: ` : "") + i.message),
      };
    }

    const d = parsed.data;
    const sugestoes = sugerirDuplicidade(
      { cidade: d.cidade, endereco: d.endereco, lat: d.lat ?? null, lng: d.lng ?? null, transformador: d.transformador ?? null, uc: d.uc ?? null, conjunto: d.conjunto ?? null, tipo: d.tipo },
      candidatasAcumuladas, agoraMs, params,
    );
    candidatasAcumuladas.push({
      id: `linha-${reg.linha}`, numero: `linha ${reg.linha}`, cidade: d.cidade, endereco: d.endereco,
      status: "Aguardando despacho", codigo: 0, tipo: d.tipo, lat: d.lat ?? null, lng: d.lng ?? null,
      transformador: d.transformador ?? null, uc: d.uc ?? null, conjunto: d.conjunto ?? null, abertaEmMs: agoraMs,
    });
    return { linha: reg.linha, status: "valida", dados: d, duplicidade: sugestoes };
  });

  return {
    cabecalho,
    linhas,
    totalLinhas: linhas.length,
    totalValidas: linhas.filter((l) => l.status === "valida").length,
    totalComDuplicidadeSuspeita: linhas.filter((l): l is LinhaImportacaoValida => l.status === "valida" && l.duplicidade.length > 0).length,
    totalComErro: linhas.filter((l) => l.status === "erro").length,
  };
}
