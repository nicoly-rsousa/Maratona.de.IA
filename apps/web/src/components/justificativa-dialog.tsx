"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import ErrorOutline from "@mui/icons-material/ErrorOutlineOutlined";
import { Icone } from "./icone";

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
  const base = useId();
  const tid = `${base}-titulo`;
  const campoId = `${base}-texto`;
  const erroId = `${base}-erro`;
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
    <dialog ref={ref} className="dialog" aria-labelledby={tid} onCancel={(e) => { e.preventDefault(); onCancelar(); }}>
      <form className="dialog__form" onSubmit={confirmar} noValidate>
        <h2 id={tid} className="dialog__title">{titulo}</h2>
        <div className="form-field">
          <label htmlFor={campoId} className="form-field__label">
            Justificativa<span className="form-field__required" aria-hidden="true">*</span><span className="sr-only"> (obrigatória)</span>
          </label>
          <textarea
            ref={campo}
            id={campoId}
            rows={3}
            className="control"
            aria-required
            aria-invalid={erro}
            aria-describedby={erro ? erroId : undefined}
            value={texto}
            onChange={(e) => { setTexto(e.target.value); setErro(false); }}
          />
          {erro && (
            <span id={erroId} className="form-field__error" role="alert">
              <Icone de={ErrorOutline} />A justificativa é obrigatória. Escreva o motivo para continuar.
            </span>
          )}
        </div>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onCancelar}>Voltar</button>
          <button type="submit" className="button button--primary">Confirmar</button>
        </div>
      </form>
    </dialog>
  );
}
