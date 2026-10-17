import type { ReactNode } from "react";
import ErrorOutline from "@mui/icons-material/ErrorOutlineOutlined";
import { Icone } from "./icone";

/** Atributos que ligam o controle ao rótulo, à dica e ao erro. Espalhe no input/select/textarea. */
export interface AcessibilidadeCampo {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}

interface Props {
  id: string;
  rotulo: ReactNode;
  /** Texto de orientação abaixo do campo (formato, unidade, efeito). */
  dica?: ReactNode;
  /** Mensagem de validação do campo; liga aria-invalid. */
  erro?: string | null;
  obrigatorio?: boolean;
  className?: string;
  children: (a11y: AcessibilidadeCampo) => ReactNode;
}

/** Rótulo visível + controle + dica + erro junto do campo, ligados por id/aria-describedby. */
export function CampoFormulario({ id, rotulo, dica, erro, obrigatorio, className, children }: Props) {
  const dicaId = dica ? `${id}-dica` : undefined;
  const erroId = erro ? `${id}-erro` : undefined;
  const descritores = [erroId, dicaId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className ? `form-field ${className}` : "form-field"}>
      <label htmlFor={id} className="form-field__label">
        {rotulo}
        {obrigatorio && <span className="form-field__required" aria-hidden="true">*</span>}
        {obrigatorio && <span className="sr-only"> (obrigatório)</span>}
      </label>
      {children({
        id,
        "aria-describedby": descritores,
        ...(erro ? { "aria-invalid": true as const } : {}),
        ...(obrigatorio ? { "aria-required": true as const } : {}),
      })}
      {erro && <span id={erroId} className="form-field__error"><Icone de={ErrorOutline} />{erro}</span>}
      {dica && <span id={dicaId} className="form-field__hint">{dica}</span>}
    </div>
  );
}

interface CheckboxProps {
  rotulo: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/** Caixa de seleção com o rótulo ao lado (a área de clique inclui o texto). */
export function CampoCheckbox({ rotulo, checked, onChange, disabled, className }: CheckboxProps) {
  return (
    <label className={className ? `form-field form-field--inline ${className}` : "form-field form-field--inline"}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="form-field__label">{rotulo}</span>
    </label>
  );
}
