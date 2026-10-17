import type { ReactNode } from "react";

interface Props {
  titulo: ReactNode;
  descricao?: ReactNode;
  /** Linha acima do título (ex.: link "Voltar à fila"). */
  antes?: ReactNode;
  acoes?: ReactNode;
}

/** Cabeçalho da tela: único h1 da página, descrição e ações principais. */
export function CabecalhoPagina({ titulo, descricao, antes, acoes }: Props) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        {antes && <div className="page-header__eyebrow">{antes}</div>}
        <h1 className="page-header__title">{titulo}</h1>
        {descricao && <p className="page-header__description">{descricao}</p>}
      </div>
      {acoes && <div className="page-header__actions">{acoes}</div>}
    </header>
  );
}
