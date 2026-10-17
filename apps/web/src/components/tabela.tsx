import type { ReactNode } from "react";

interface Props {
  /** Nome da tabela para leitores de tela (caption) e da área rolável. */
  legenda: string;
  /** Largura do conteúdo, em vez de ocupar a linha toda. */
  compacta?: boolean;
  children: ReactNode;
}

/** Tabela de dados com rolagem horizontal contida e focável (teclado rola a área sem a página rolar de lado). */
export function Tabela({ legenda, compacta, children }: Props) {
  return (
    <div className="data-table" role="region" aria-label={legenda} tabIndex={0}>
      <table className={compacta ? "data-table__table data-table__table--compact" : "data-table__table"}>
        <caption className="sr-only">{legenda}</caption>
        {children}
      </table>
    </div>
  );
}
