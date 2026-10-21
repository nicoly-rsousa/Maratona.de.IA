// Código de cidade (id) para os municípios da importação. O banco exige ^[A-Z]{2,5}$ (ck_cidade_id_formato) e o id é chave:
// quem chama guarda o município de origem junto da cidade (cidades.municipio_origem) e só gera código para município NOVO,
// então o código de uma cidade já criada nunca muda. Função pura e determinística.

export const FORMATO_CODIGO_CIDADE = /^[A-Z]{2,5}$/;

const LIGACAO = new Set(["DE", "DA", "DO", "DAS", "DOS", "E"]);
const A = "A".charCodeAt(0);

function palavras(nome: string): string[] {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().split(/[^A-Z]+/).filter(Boolean);
}

/** FNV-1a de 32 bits: estável entre execuções (sem aleatoriedade), só para desempate. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

const duasLetras = (n: number) => String.fromCharCode(A + (n % 26)) + String.fromCharCode(A + (Math.floor(n / 26) % 26));

/**
 * Código de 2 a 5 letras para o nome, sem repetir nenhum de `ocupados` (que não é alterado).
 * Ordem de tentativa: 5, 4, 3 e 2 primeiras letras; depois 4 letras + cada letra seguinte do nome;
 * por fim 3 letras + duas letras derivadas de um hash do nome (determinístico), até achar uma livre.
 */
export function codigoDaCidade(nome: string, ocupados: ReadonlySet<string>): string {
  let ps = palavras(nome);
  const semLigacao = ps.filter((p) => !LIGACAO.has(p));
  if (semLigacao.length > 0) ps = semLigacao;
  let base = ps.join("");
  if (base === "") base = "XX";
  if (base.length < 2) base = base.padEnd(2, "X");

  const livre = (c: string) => FORMATO_CODIGO_CIDADE.test(c) && !ocupados.has(c);

  for (const n of [5, 4, 3, 2]) {
    if (base.length >= n && livre(base.slice(0, n))) return base.slice(0, n);
  }
  const p4 = base.slice(0, 4);
  if (p4.length === 4) {
    for (const letra of base.slice(4)) if (livre(p4 + letra)) return p4 + letra;
  }
  const p3 = base.slice(0, 3).padEnd(3, "X");
  const h = hash(nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase());
  for (let k = 0; k < 26 * 26; k++) {
    const c = p3 + duasLetras(h + k);
    if (livre(c)) return c;
  }
  // 676 variações do mesmo prefixo esgotadas: muda o prefixo (praticamente inalcançável; garante terminação)
  for (let k = 0; k < 26 * 26 * 26; k++) {
    const c = String.fromCharCode(A + (h % 26)) + String.fromCharCode(A + (Math.floor(h / 26) % 26)) + String.fromCharCode(A + (k % 26)) + duasLetras(Math.floor(k / 26));
    if (livre(c)) return c;
  }
  throw new Error("Sem código de cidade livre.");
}
