import type { ReactNode } from "react";
import { CODIGOS } from "@farol/shared";
import { ApiError } from "@/lib/api";

/** Pílula de prioridade (cor = código; 0 = mais urgente). */
export function Pill({ codigo }: { codigo: number }) {
  return <span className={`pill k${codigo}`}>{CODIGOS[codigo] ?? `Código ${codigo}`}</span>;
}

export function Carregando({ texto }: { texto: string }) {
  return (
    <div role="status">
      <div className="sk" />
      <div className="sk" />
      <div className="sk" />
      <p className="mu">{texto}</p>
    </div>
  );
}

/** Erro da API: 403 (fora do escopo/sem permissão), 404 e falhas de rede com mensagens próprias. */
export function ErroApi({ erro, titulo, onRetry }: { erro: unknown; titulo: string; onRetry?: () => void }) {
  const status = erro instanceof ApiError ? erro.status : 0;
  const msg = erro instanceof Error ? erro.message : "Erro desconhecido.";
  let corpo: ReactNode;
  if (status === 403) {
    corpo = <><b>403 — fora do seu escopo.</b> Você não tem acesso a este recurso. O acesso foi registrado na auditoria.</>;
  } else if (status === 404) {
    corpo = <><b>Não encontrado.</b> {msg}</>;
  } else {
    corpo = <><b>{titulo}</b> {msg}</>;
  }
  return (
    <div className="err" role="alert">
      {corpo}
      {onRetry && status !== 403 && status !== 404 && (
        <> <button onClick={onRetry}>Tentar novamente</button></>
      )}
    </div>
  );
}
