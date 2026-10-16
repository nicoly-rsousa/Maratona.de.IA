import type { VersaoPontuacao } from "./types";

export interface ResultadoValidacao {
  erros: string[]; // bloqueiam a publicação
  alertas: string[]; // não bloqueiam
}

/**
 * Pares de coerência (§5), só ALERTA: a opção `maior` não deve valer menos que a `menor`.
 * Os rótulos são os do cadastro de classes do cliente; o par só vale dentro de um mesmo critério.
 */
const COERENCIA: readonly { maior: string; menor: string }[] = [{ maior: "Essencial", menor: "Residencial" }];

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

/**
 * Erros (bloqueiam) e alertas (não bloqueiam) de uma versão de pontuação (§5).
 * `maxPontos` é configuração do banco (`pontuacao.max_pontos`): nunca um valor fixo no código.
 * O banco repete os ERROS em `validar_conteudo_pontuacao` (0005); os alertas existem só aqui.
 */
export function validarVersao(v: VersaoPontuacao, maxPontos: number): ResultadoValidacao {
  const erros: string[] = [];
  const alertas: string[] = [];

  for (const c of v.criterios.filter((x) => x.habilitado)) {
    for (const o of c.opcoes) {
      if (o.pontos == null) erros.push(`"${c.nome} → ${o.label}": sem pontos definidos.`);
      else if (!Number.isInteger(o.pontos) || o.pontos < 0) erros.push(`"${c.nome} → ${o.label}": use um inteiro maior ou igual a 0.`);
      else if (o.pontos > maxPontos) erros.push(`"${c.nome} → ${o.label}": acima do máximo (${maxPontos}).`);
      if (o.desconhecida && o.pontos === 0 && !o.requerConfirmacao)
        alertas.push(`"${c.nome}": opção desconhecida vale 0 sem "requer confirmação".`);
    }
    if (!c.opcoes.some((o) => o.desconhecida)) alertas.push(`"${c.nome}": sem opção "desconhecida".`);

    for (const par of COERENCIA) {
      const maior = c.opcoes.find((o) => norm(o.label) === norm(par.maior));
      const menor = c.opcoes.find((o) => norm(o.label) === norm(par.menor));
      if (maior?.pontos != null && menor?.pontos != null && maior.pontos < menor.pontos)
        alertas.push(`"${c.nome}": "${maior.label}" vale ${maior.pontos}, menos que "${menor.label}" (${menor.pontos}).`);
    }
  }

  const f = [...v.faixas].sort((a, b) => a.de - b.de);
  if (f.length === 0) erros.push("Nenhuma faixa definida.");
  else {
    if (f[0]!.de !== 0) erros.push("As faixas devem começar em 0.");
    for (let i = 0; i < f.length; i++) {
      const cur = f[i]!;
      const next = f[i + 1];
      if (cur.ate != null && cur.ate < cur.de) erros.push(`Faixa ${cur.de}: "até" menor que "de".`);
      if (next) {
        if (cur.ate == null) erros.push("Faixa sem limite só pode ser a última.");
        else if (next.de > cur.ate + 1) erros.push(`Lacuna entre ${cur.ate} e ${next.de}.`);
        else if (next.de <= cur.ate) erros.push(`Sobreposição entre faixas em ${next.de}.`);
      }
    }
    if (f[f.length - 1]!.ate != null) erros.push('A última faixa deve ser "sem limite".');
  }
  return { erros, alertas };
}
