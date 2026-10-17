"use client";

import Add from "@mui/icons-material/Add";
import DeleteOutline from "@mui/icons-material/DeleteOutlineOutlined";
import { CODIGOS, type CriterioParaRegra, type Regra } from "@farol/shared";
import { CampoFormulario } from "@/components/campo";
import { EstadoVazio } from "@/components/estados";
import { Icone } from "@/components/icone";

/** Identificador de regra nova: único na prática e no formato aceito (letras, números, "-"). */
const novoId = () => `R-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296).toString(36).toUpperCase()}`;

export const regraEmBranco = (): Regra => ({ id: novoId(), nome: "", ativa: true, nivel: 1, prioridadeMinima: 2, cond: [] });

interface CardProps {
  r: Regra;
  criterios: CriterioParaRegra[];
  onChange: (r: Regra) => void;
  onRemover: () => void;
  desabilitado: boolean;
}

function RegraCard({ r, criterios, onChange, onRemover, desabilitado }: CardProps) {
  const k = `rg_${r.id}`;
  const nomeRegra = r.nome || r.id;
  const set = (p: Partial<Regra>) => onChange({ ...r, ...p });
  const setCond = (j: number, c: Regra["cond"][number]) => set({ cond: r.cond.map((x, i) => (i === j ? c : x)) });

  return (
    <div className="card" role="group" aria-label={`Regra ${nomeRegra}`}>
      <div className="rule-card__fields">
        <label className="form-field form-field--inline self-center">
          <input id={`${k}_ativa`} type="checkbox" checked={r.ativa} disabled={desabilitado} onChange={(e) => set({ ativa: e.target.checked })} />
          <span className="form-field__label">Ativa</span>
        </label>
        <CampoFormulario id={`${k}_nome`} rotulo={<>Nome <span className="rule-card__id">{r.id}</span></>}>
          {(a) => <input {...a} className="control" value={r.nome} disabled={desabilitado} autoComplete="off" onChange={(e) => set({ nome: e.target.value })} />}
        </CampoFormulario>
        <CampoFormulario id={`${k}_nivel`} rotulo="Nível (1–10)">
          {(a) => (
            <input
              {...a} type="number" min={1} max={10} step={1} className="control control--mono" disabled={desabilitado}
              value={Number.isFinite(r.nivel) && r.nivel !== 0 ? r.nivel : ""}
              onChange={(e) => set({ nivel: e.target.value === "" ? 0 : Number(e.target.value) })}
            />
          )}
        </CampoFormulario>
        <CampoFormulario id={`${k}_prio`} rotulo="Prioridade mínima">
          {(a) => (
            <select {...a} className="control" value={r.prioridadeMinima} disabled={desabilitado} onChange={(e) => set({ prioridadeMinima: Number(e.target.value) })}>
              {CODIGOS.map((nome, cod) => <option key={cod} value={cod}>{nome}</option>)}
            </select>
          )}
        </CampoFormulario>
        <button type="button" className="button button--danger" disabled={desabilitado} onClick={onRemover} aria-label={`Remover a regra ${nomeRegra}`}>
          <Icone de={DeleteOutline} />Remover regra
        </button>
      </div>

      <h3 className="page__section-title">Condições <span className="page__section-hint">— todas precisam valer (E); em cada uma, basta uma das opções</span></h3>
      {r.cond.length === 0 && <p className="text-muted">Nenhuma condição: adicione pelo menos uma.</p>}
      {r.cond.map((c, j) => {
        const crit = criterios.find((x) => x.id === c.criterio);
        const doCriterio = crit?.opcoes ?? [];
        // opções que a regra cita mas a versão de pontuação não tem mais: aparecem marcadas para poderem ser tiradas
        const opcoes = [...doCriterio, ...c.opcoes.filter((o) => !doCriterio.includes(o))];
        const cid = `${k}_c${j}`;
        return (
          <div key={j} className="rule-card__condition">
            <CampoFormulario id={`${cid}_crit`} rotulo="Critério">
              {(a) => (
                <select {...a} className="control" value={c.criterio} disabled={desabilitado} onChange={(e) => setCond(j, { criterio: e.target.value, opcoes: [] })}>
                  {!crit && <option value={c.criterio}>{c.criterio || "Escolha…"}{c.criterio ? " (não existe)" : ""}</option>}
                  {criterios.map((x) => <option key={x.id} value={x.id}>{x.nome}{x.habilitado ? "" : " (desabilitado)"}</option>)}
                </select>
              )}
            </CampoFormulario>
            <fieldset className="form-group" disabled={desabilitado}>
              <legend className="form-field__label">Opções</legend>
              <div className="rule-card__options">
                {opcoes.map((o, n) => {
                  const marcada = c.opcoes.includes(o);
                  const existe = doCriterio.includes(o);
                  return (
                    <label key={o} htmlFor={`${cid}_o${n}`} className="form-field form-field--inline">
                      <input
                        id={`${cid}_o${n}`} type="checkbox" checked={marcada}
                        onChange={(e) => setCond(j, { ...c, opcoes: e.target.checked ? [...c.opcoes, o] : c.opcoes.filter((x) => x !== o) })}
                      />
                      <span>{o}{!existe && <span className="rule-card__missing"> (não existe)</span>}</span>
                    </label>
                  );
                })}
                {opcoes.length === 0 && <span className="text-muted">Escolha um critério.</span>}
              </div>
            </fieldset>
            <button
              type="button" className="button button--ghost button--sm self-end" disabled={desabilitado}
              onClick={() => onChange({ ...r, cond: r.cond.filter((_, i) => i !== j) })}
              aria-label={`Remover a condição ${j + 1} da regra ${nomeRegra}`}
            >
              <Icone de={DeleteOutline} />Remover condição
            </button>
          </div>
        );
      })}
      <div>
        <button
          type="button" className="button button--sm" disabled={desabilitado || criterios.length === 0}
          onClick={() => set({ cond: [...r.cond, { criterio: criterios.find((x) => !r.cond.some((c) => c.criterio === x.id))?.id ?? criterios[0]?.id ?? "", opcoes: [] }] })}
        >
          <Icone de={Add} />Adicionar condição
        </button>
      </div>
    </div>
  );
}

interface Props {
  regras: Regra[];
  criterios: CriterioParaRegra[];
  onChange: (regras: Regra[]) => void;
  desabilitado: boolean;
}

/** Editor da camada A: uma ficha por regra (ativa, nome, nível, prioridade mínima, condições), mais adicionar e remover. */
export function EditorRegras({ regras, criterios, onChange, desabilitado }: Props) {
  return (
    <>
      {regras.length === 0 && <EstadoVazio>Nenhuma regra: a prioridade depende só da pontuação.</EstadoVazio>}
      {regras.map((r, i) => (
        <RegraCard
          key={r.id} r={r} criterios={criterios} desabilitado={desabilitado}
          onChange={(nova) => onChange(regras.map((x, n) => (n === i ? nova : x)))}
          onRemover={() => onChange(regras.filter((_, n) => n !== i))}
        />
      ))}
      <div>
        <button type="button" className="button" disabled={desabilitado || criterios.length === 0} onClick={() => onChange([...regras, regraEmBranco()])}>
          <Icone de={Add} />Adicionar regra
        </button>
      </div>
    </>
  );
}
