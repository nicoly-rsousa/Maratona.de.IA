import { z } from "zod";
import type { ResultadoValidacao } from "./validate";
import { planejarReclassificacao, type VersaoPublicada } from "./versionamento";
import { CODIGOS, type Fatos, type Regra, type VersaoPontuacao } from "./types";

/** Identificador da regra: livre dentro deste formato, único no conjunto. */
export const ID_REGRA_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

/**
 * Corpo das requisições de edição. Os limites (nível 1–10, prioridade 0–4, condições…) NÃO estão aqui de propósito:
 * quem decide é `validarRegras`, que devolve todas as mensagens de uma vez em vez de um erro de formato por vez.
 */
export const RegraEntradaSchema = z.object({
  id: z.string(),
  nome: z.string(),
  ativa: z.boolean(),
  cond: z.array(z.object({ criterio: z.string(), opcoes: z.array(z.string()) })),
  nivel: z.number(),
  prioridadeMinima: z.number(),
});
export const PreverRegrasSchema = z.object({ regras: z.array(RegraEntradaSchema).max(200) });
export const SalvarRegrasSchema = PreverRegrasSchema.extend({
  /** número da versão do conjunto que o cliente carregou; outra no servidor → 409 */
  versaoBase: z.number().int().positive(),
  justificativa: z.string().trim().min(1, "Informe a justificativa."),
});

const inteiroEntre = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;

/**
 * Erros (bloqueiam a gravação) e alertas (não bloqueiam) de um conjunto de regras da camada A.
 * Critérios e opções são conferidos contra a versão de pontuação `base` (a vigente), nunca contra uma lista fixa.
 * `outras` = versões vigentes próprias de cidades: ali só gera ALERTA (a regra poderia nunca se aplicar naquela cidade).
 */
export function validarRegras(
  regras: readonly Regra[], base: VersaoPontuacao, outras: readonly { escopo: string; versao: VersaoPontuacao }[] = [],
): ResultadoValidacao {
  const erros: string[] = [];
  const alertas: string[] = [];
  const ids = new Set<string>();
  const maxCodigo = CODIGOS.length - 1;

  regras.forEach((r, i) => {
    const id = (r.id ?? "").trim();
    const L = `Regra "${r.nome?.trim() || id || `nº ${i + 1}`}"`;

    if (!id) erros.push(`${L}: informe o identificador.`);
    else if (!ID_REGRA_RE.test(r.id)) erros.push(`${L}: identificador inválido (letras, números, "-" e "_", até 40 caracteres).`);
    else if (ids.has(r.id)) erros.push(`Identificador repetido: "${r.id}".`);
    ids.add(r.id);

    if (!r.nome || !r.nome.trim()) erros.push(`${L}: informe o nome.`);
    if (!inteiroEntre(r.nivel, 1, 10)) erros.push(`${L}: o nível deve ser um inteiro de 1 a 10.`);
    if (!inteiroEntre(r.prioridadeMinima, 0, maxCodigo)) {
      erros.push(`${L}: a prioridade mínima deve ser um inteiro de 0 a ${maxCodigo} (0 = ${CODIGOS[0]}, ${maxCodigo} = ${CODIGOS[maxCodigo]}).`);
    } else if (r.prioridadeMinima === maxCodigo) {
      alertas.push(`${L}: a prioridade mínima ${CODIGOS[maxCodigo]} não muda o código (toda OS já é, no mínimo, ${CODIGOS[maxCodigo]}); a regra só afeta o nível.`);
    }

    if (r.cond.length === 0) erros.push(`${L}: informe pelo menos uma condição.`);
    const vistos = new Set<string>();
    for (const c of r.cond) {
      const crit = base.criterios.find((x) => x.id === c.criterio);
      if (!crit) {
        erros.push(`${L}: o critério "${c.criterio}" não existe na versão de pontuação vigente (v${base.v}).`);
        continue;
      }
      if (vistos.has(c.criterio)) erros.push(`${L}: o critério "${crit.nome}" aparece mais de uma vez; reúna as opções numa só condição.`);
      vistos.add(c.criterio);
      if (!crit.habilitado) alertas.push(`${L}: o critério "${crit.nome}" está desabilitado na versão de pontuação (v${base.v}); a regra continua valendo, mas ele não soma pontos.`);
      if (c.opcoes.length === 0) erros.push(`${L}: a condição em "${crit.nome}" precisa de ao menos uma opção.`);
      const opVistas = new Set<string>();
      for (const o of c.opcoes) {
        if (!crit.opcoes.some((x) => x.label === o)) erros.push(`${L}: a opção "${o}" não existe em "${crit.nome}" (v${base.v}).`);
        else if (opVistas.has(o)) erros.push(`${L}: opção repetida em "${crit.nome}": "${o}".`);
        opVistas.add(o);
      }
    }
  });

  if (!regras.some((r) => r.ativa)) alertas.push("Nenhuma regra ativa: a prioridade passa a depender só da pontuação.");

  for (const { escopo, versao } of outras) {
    for (const r of regras.filter((x) => x.ativa)) {
      const faltas: string[] = [];
      for (const c of r.cond) {
        const crit = versao.criterios.find((x) => x.id === c.criterio);
        if (!crit) { faltas.push(`o critério "${c.criterio}"`); continue; }
        for (const o of c.opcoes) if (!crit.opcoes.some((x) => x.label === o)) faltas.push(`a opção "${o}" de "${crit.nome}"`);
      }
      if (faltas.length) alertas.push(`Em ${escopo} (versão v${versao.v} da cidade), a regra "${r.nome.trim() || r.id}" cita ${faltas.join(" e ")}, que essa versão não tem: lá ela não se aplicaria.`);
    }
  }
  return { erros, alertas };
}

// ───────── previsão de impacto ─────────
export interface OSParaImpacto {
  id: string;
  numero: string;
  cidade: string;
  tipo: string;
  fatos: Fatos;
  abertaEmMs: number;
  prazoLimiteMs: number | null;
  /** versão de pontuação em que a OS está (a previsão mede só o efeito das regras, nessa mesma versão) */
  versaoId: string | null;
}

export interface ResumoResultado {
  codigo: number;
  nivel: number;
  pontos: number;
  /** ids das regras aplicadas */
  regras: string[];
}

export interface MudancaImpacto {
  osId: string;
  numero: string;
  cidade: string;
  antes: ResumoResultado;
  depois: ResumoResultado;
}

export interface ImpactoRegras {
  /** OS abertas avaliadas */
  total: number;
  /** OS sem nenhuma versão de pontuação aplicável: não entram na previsão */
  semVersao: number;
  /** OS cujo código OU nível mudaria */
  mudaram: number;
  codigoMudou: number;
  nivelMudou: number;
  /** código mais urgente depois (índice menor) */
  sobemCodigo: number;
  /** código menos urgente depois */
  descemCodigo: number;
  /** OS por código (índice = código), antes e depois */
  distribuicao: { antes: number[]; depois: number[] };
  /** só as OS que mudam, por cidade e número */
  mudancas: MudancaImpacto[];
}

/**
 * Quantas OS abertas mudariam de código ou nível se `novas` substituíssem `atuais`. Função pura: usa o mesmo
 * planejamento da reclassificação (`planejarReclassificacao`) com a versão de pontuação da própria OS e o mesmo instante,
 * para que o "antes" e o "depois" difiram só pelas regras (os pontos nunca mudam).
 */
export function preverImpacto(
  abertas: readonly OSParaImpacto[], publicadas: VersaoPublicada[], atuais: Regra[], novas: Regra[], agoraMs: number,
): ImpactoRegras {
  const zeros = () => CODIGOS.map(() => 0);
  const out: ImpactoRegras = {
    total: abertas.length, semVersao: 0, mudaram: 0, codigoMudou: 0, nivelMudou: 0, sobemCodigo: 0, descemCodigo: 0,
    distribuicao: { antes: zeros(), depois: zeros() }, mudancas: [],
  };

  for (const o of abertas) {
    const calc = (regras: Regra[]) =>
      planejarReclassificacao(
        {
          cidade: o.cidade, tipo: o.tipo, fatos: o.fatos, abertaEmMs: o.abertaEmMs, prazoLimiteMs: o.prazoLimiteMs,
          versaoId: o.versaoId, anterior: { codigo: 0, pontos: 0, nivel: 0 },
        },
        { publicadas, regras, agoraMs, migrar: false, motivo: "" },
      )?.resultado;
    const a = calc(atuais);
    const d = calc(novas);
    if (!a || !d) { out.semVersao++; continue; }

    const antes: ResumoResultado = { codigo: a.codigo, nivel: a.nivel, pontos: a.pontos, regras: a.regrasAplicadas };
    const depois: ResumoResultado = { codigo: d.codigo, nivel: d.nivel, pontos: d.pontos, regras: d.regrasAplicadas };
    out.distribuicao.antes[antes.codigo]!++;
    out.distribuicao.depois[depois.codigo]!++;

    const cod = antes.codigo !== depois.codigo;
    const niv = antes.nivel !== depois.nivel;
    if (!cod && !niv) continue;
    out.mudaram++;
    if (cod) { out.codigoMudou++; if (depois.codigo < antes.codigo) out.sobemCodigo++; else out.descemCodigo++; }
    if (niv) out.nivelMudou++;
    out.mudancas.push({ osId: o.id, numero: o.numero, cidade: o.cidade, antes, depois });
  }

  out.mudancas.sort((x, y) => x.cidade.localeCompare(y.cidade) || x.numero.localeCompare(y.numero));
  return out;
}
