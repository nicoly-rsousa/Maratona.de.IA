/** Erros das funções do banco (0004+): SQLSTATE próprio → HTTP. O HINT diz qual regra falhou. */
const HTTP_POR_CODIGO: Record<string, number> = { FD400: 400, FD403: 403, FD404: 404, FD409: 409 };

export function traduzirErroRpc(e: { code?: string; message: string; hint?: string | null }): { status: number; corpo: { erro: string; regra?: string } } {
  const status = HTTP_POR_CODIGO[e.code ?? ""];
  if (!status) return { status: 500, corpo: { erro: e.message } };
  return { status, corpo: { erro: e.message, ...(e.hint ? { regra: e.hint } : {}) } };
}
