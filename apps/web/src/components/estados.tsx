import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { SvgIconComponent } from "@mui/icons-material";
import Inbox from "@mui/icons-material/Inbox";
import { Alerta, ErroApi } from "./alerta";
import { Icone } from "./icone";

/** Esqueleto de carregamento com texto anunciado a leitores de tela. */
export function Carregando({ texto, bloco }: { texto: string; bloco?: boolean }) {
  return (
    <div className="loading" role="status">
      {bloco ? <div className="loading__line loading__line--block" /> : <><div className="loading__line" /><div className="loading__line" /><div className="loading__line" /></>}
      <p className="loading__text">{texto}</p>
    </div>
  );
}

/** Ausência de dados (não é erro nem carregamento). */
export function EstadoVazio({ children, icone = Inbox }: { children: ReactNode; icone?: SvgIconComponent }) {
  return (
    <div className="empty-state">
      <Icone de={icone} grande />
      <p className="empty-state__text">{children}</p>
    </div>
  );
}

interface EstadoConsultaProps<T> {
  consulta: UseQueryResult<T>;
  /** Texto do carregamento, ex.: "Carregando a fila…". */
  carregando: string;
  /** Título do erro, ex.: "Não foi possível carregar a fila.". */
  erro: string;
  children: (dados: T) => ReactNode;
}

/** Carregando → erro (com "Tentar novamente") → dados: o mesmo fluxo em todas as telas. */
export function EstadoConsulta<T>({ consulta, carregando, erro, children }: EstadoConsultaProps<T>) {
  if (consulta.isPending) return <Carregando texto={carregando} />;
  if (consulta.isError) return <ErroApi erro={consulta.error} titulo={erro} onRetry={() => consulta.refetch()} />;
  return <>{children(consulta.data)}</>;
}

/** Usuário sem município vinculado: nada a mostrar até um administrador vincular. */
export function SemCidade() {
  return (
    <Alerta tipo="warning" titulo="Sem cidade vinculada">
      Seu usuário não tem cidade vinculada. Peça a um administrador para vinculá-lo a um município.
    </Alerta>
  );
}
