import { mensagemDeAcessoRede, statusDoErro } from "@/lib/rede";

/** Erro de uma consulta da rede: 403 (sem acesso ao módulo, o servidor decide), 401, 404 e falhas com "tentar novamente". */
export function ErroRede({ erro, titulo, onRetry }: { erro: unknown; titulo: string; onRetry?: () => void }) {
  const status = statusDoErro(erro);
  const msg = erro instanceof Error ? erro.message : undefined;
  const m = mensagemDeAcessoRede(status, msg);
  const semRetry = status === 403 || status === 404 || status === 401;
  return (
    <div className="err" role="alert">
      <b>{status === 403 ? "Sem acesso." : titulo}</b> {m.texto}
      {onRetry && !semRetry && <> <button type="button" onClick={onRetry}>Tentar novamente</button></>}
    </div>
  );
}

export function Vazio({ texto }: { texto: string }) {
  return <div className="box" role="status"><p className="mu" style={{ margin: 0 }}>{texto}</p></div>;
}
