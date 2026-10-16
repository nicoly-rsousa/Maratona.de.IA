"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

interface Props {
  aberto: boolean;
  /** Pergunta exibida no topo, ex.: "Motivo do cancelamento". */
  titulo: string;
  onConfirmar: (justificativa: string) => void;
  /** Chamado ao voltar, ao pressionar Esc ou ao fechar sem confirmar. */
  onCancelar: () => void;
}

/** Diálogo de justificativa obrigatória (equivale ao <dialog id="dlg"> do protótipo). */
export function JustificativaDialog({ aberto, titulo, onConfirmar, onCancelar }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) {
      setTexto("");
      setErro(false);
      d.showModal();
      campo.current?.focus();
    } else if (!aberto && d.open) {
      d.close();
    }
  }, [aberto]);

  function confirmar(e: FormEvent) {
    e.preventDefault();
    const j = texto.trim();
    if (!j) { setErro(true); campo.current?.focus(); return; }
    onConfirmar(j);
  }

  return (
    <dialog ref={ref} aria-labelledby="dlg-titulo" onCancel={(e) => { e.preventDefault(); onCancelar(); }}>
      <form onSubmit={confirmar}>
        <p id="dlg-titulo">{titulo}</p>
        <textarea
          ref={campo}
          rows={3}
          className="w-full"
          aria-label="Justificativa"
          aria-invalid={erro}
          value={texto}
          onChange={(e) => { setTexto(e.target.value); setErro(false); }}
        />
        {erro && <div className="err" role="alert">A justificativa é obrigatória. Escreva o motivo para continuar.</div>}
        <p>
          <button type="submit" className="btn-pr">Confirmar</button>{" "}
          <button type="button" onClick={onCancelar}>Voltar</button>
        </p>
      </form>
    </dialog>
  );
}
