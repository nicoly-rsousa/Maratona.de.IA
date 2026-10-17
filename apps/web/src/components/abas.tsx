"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

interface Props<T extends string> {
  abas: readonly T[];
  ativa: T;
  onMudar: (aba: T) => void;
  /** Nome do conjunto de abas (aria-label do tablist). */
  rotulo: string;
  children: ReactNode;
}

/** Abas ARIA: setas ←/→, Home e End movem o foco e ativam; só a aba ativa entra na ordem de Tab (roving tabindex). */
export function Abas<T extends string>({ abas, ativa, onMudar, rotulo, children }: Props<T>) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idAba = (t: T) => `${base}-aba-${abas.indexOf(t)}`;
  const idPainel = `${base}-painel`;

  function teclado(e: KeyboardEvent<HTMLDivElement>) {
    const i = abas.indexOf(ativa);
    const alvo =
      e.key === "ArrowRight" ? (i + 1) % abas.length
      : e.key === "ArrowLeft" ? (i - 1 + abas.length) % abas.length
      : e.key === "Home" ? 0
      : e.key === "End" ? abas.length - 1
      : -1;
    if (alvo < 0) return;
    e.preventDefault();
    onMudar(abas[alvo]!);
    refs.current[alvo]?.focus();
  }

  return (
    <div className="tabs">
      <div className="tabs__list" role="tablist" aria-label={rotulo} onKeyDown={teclado}>
        {abas.map((t, i) => (
          <button
            key={t}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={idAba(t)}
            aria-selected={t === ativa}
            aria-controls={idPainel}
            tabIndex={t === ativa ? 0 : -1}
            className={t === ativa ? "tabs__tab tabs__tab--active" : "tabs__tab"}
            onClick={() => onMudar(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="tabs__panel card" role="tabpanel" id={idPainel} aria-labelledby={idAba(ativa)} tabIndex={0}>
        {children}
      </div>
    </div>
  );
}
