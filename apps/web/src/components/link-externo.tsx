import type { ReactNode } from "react";
import OpenInNew from "@mui/icons-material/OpenInNew";
import { Icone } from "./icone";

interface Props {
  href: string;
  children: ReactNode;
  /** Classes BEM do link (padrão: "link"; ex.: "button button--sm", "link link--chip"). */
  className?: string;
  /** Texto completo para leitores de tela quando o visível é ambíguo (ex.: "Ir no Maps" numa lista). */
  rotulo?: string;
}

/** Link que abre em nova aba: ícone visível e aviso para leitores de tela. */
export function LinkExterno({ href, children, className = "link", rotulo }: Props) {
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer" aria-label={rotulo ? `${rotulo} (abre em nova aba)` : undefined}>
      {children}
      <Icone de={OpenInNew} />
      {!rotulo && <span className="sr-only"> (abre em nova aba)</span>}
    </a>
  );
}
