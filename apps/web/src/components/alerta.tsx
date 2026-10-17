import type { ReactNode } from "react";
import type { SvgIconComponent } from "@mui/icons-material";
import CheckCircleOutline from "@mui/icons-material/CheckCircleOutlineOutlined";
import ErrorOutline from "@mui/icons-material/ErrorOutlineOutlined";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import Refresh from "@mui/icons-material/Refresh";
import WarningAmber from "@mui/icons-material/WarningAmber";
import { ApiError } from "@/lib/api";
import { mensagemDeErro } from "@/lib/format";
import { Icone } from "./icone";

type Tipo = "error" | "warning" | "success" | "info";

const ICONE: Record<Tipo, SvgIconComponent> = { error: ErrorOutline, warning: WarningAmber, success: CheckCircleOutline, info: InfoOutlined };

interface AlertaProps {
  tipo: Tipo;
  titulo?: ReactNode;
  children?: ReactNode;
  /** Botões ou links de continuação ("Tentar novamente", "Recarregar"…). */
  acoes?: ReactNode;
  /** "alert" para erros que surgem após uma ação; "status" para confirmações. Sem role = aviso estático. */
  role?: "alert" | "status";
  id?: string;
}

/** Mensagem de estado padronizada: ícone + título + texto, com variante semântica. */
export function Alerta({ tipo, titulo, children, acoes, role, id }: AlertaProps) {
  return (
    <div className={`alert alert--${tipo}`} role={role} id={id}>
      <span className="alert__icon"><Icone de={ICONE[tipo]} /></span>
      <div className="alert__content">
        {titulo && <strong className="alert__title">{titulo}</strong>}
        {children}
        {acoes && <div className="alert__actions">{acoes}</div>}
      </div>
    </div>
  );
}

/** Erro ao carregar dados: 403 (fora do escopo/sem permissão), 404 e falhas de rede com mensagens próprias. */
export function ErroApi({ erro, titulo, onRetry }: { erro: unknown; titulo: string; onRetry?: () => void }) {
  const status = erro instanceof ApiError ? erro.status : 0;
  const msg = mensagemDeErro(erro);
  const definitivo = status === 403 || status === 404;
  return (
    <Alerta
      tipo="error"
      role="alert"
      titulo={status === 403 ? "403 — fora do seu escopo." : status === 404 ? "Não encontrado." : titulo}
      acoes={onRetry && !definitivo && (
        <button type="button" className="button button--sm" onClick={onRetry}><Icone de={Refresh} />Tentar novamente</button>
      )}
    >
      {status === 403 ? "Você não tem acesso a este recurso. O acesso foi registrado na auditoria." : msg}
    </Alerta>
  );
}

/** Falha de uma ação (POST/PUT): mostra o código HTTP e a mensagem específica da regra (400/403/404/409). */
export function ErroAcao({ erro }: { erro: unknown }) {
  const status = erro instanceof ApiError ? erro.status : 0;
  return (
    <Alerta tipo="error" role="alert" titulo={status > 0 ? `Erro ${status}` : "Não foi possível concluir a ação"}>
      {mensagemDeErro(erro)}
    </Alerta>
  );
}
