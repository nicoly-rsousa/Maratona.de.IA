"use client";

import { CODIGOS, type CriterioParaRegra, type Regra } from "@farol/shared";

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
  const set = (p: Partial<Regra>) => onChange({ ...r, ...p });
  const setCond = (j: number, c: Regra["cond"][number]) => set({ cond: r.cond.map((x, i) => (i === j ? c : x)) });

  return (
    <div className="box" role="group" aria-label={`Regra ${r.nome || r.id}`}>
      <div className="row">
        <label htmlFor={`${k}_ativa`}>
          Ativa
          <input id={`${k}_ativa`} type="checkbox" className="h-[26px] w-[26px]" checked={r.ativa} disabled={desabilitado} onChange={(e) => set({ ativa: e.target.checked })} />
        </label>
        <label htmlFor={`${k}_nome`} className="min-w-[220px] flex-1">
          <span>Nome <span className="m text-[11px]">{r.id}</span></span>
          <input id={`${k}_nome`} value={r.nome} disabled={desabilitado} autoComplete="off" onChange={(e) => set({ nome: e.target.value })} />
        </label>
        <label htmlFor={`${k}_nivel`}>
          Nível (1–10)
          <input
            id={`${k}_nivel`} type="number" min={1} max={10} step={1} className="w-[70px]" disabled={desabilitado}
            value={Number.isFinite(r.nivel) && r.nivel !== 0 ? r.nivel : ""}
            onChange={(e) => set({ nivel: e.target.value === "" ? 0 : Number(e.target.value) })}
          />
        </label>
        <label htmlFor={`${k}_prio`}>
          Prioridade mínima
          <select id={`${k}_prio`} value={r.prioridadeMinima} disabled={desabilitado} onChange={(e) => set({ prioridadeMinima: Number(e.target.value) })}>
            {CODIGOS.map((nome, cod) => <option key={cod} value={cod}>{nome}</option>)}
          </select>
        </label>
        <button type="button" disabled={desabilitado} onClick={onRemover}>Remover regra</button>
      </div>

      <h3>Condições <span className="mu font-normal">— todas precisam valer (E); em cada uma, basta uma das opções</span></h3>
      {r.cond.length === 0 && <p className="mu">Nenhuma condição: adicione pelo menos uma.</p>}
      {r.cond.map((c, j) => {
        const crit = criterios.find((x) => x.id === c.criterio);
        const doCriterio = crit?.opcoes ?? [];
        // opções que a regra cita mas a versão de pontuação não tem mais: aparecem marcadas para poderem ser tiradas
        const opcoes = [...doCriterio, ...c.opcoes.filter((o) => !doCriterio.includes(o))];
        const cid = `${k}_c${j}`;
        return (
          <div key={j} className="mb-2 flex flex-wrap items-start gap-2 border-t border-ln pt-2">
            <label htmlFor={`${cid}_crit`} className="flex flex-col gap-0.5 text-mu">
              Critério
              <select id={`${cid}_crit`} value={c.criterio} disabled={desabilitado} onChange={(e) => setCond(j, { criterio: e.target.value, opcoes: [] })}>
                {!crit && <option value={c.criterio}>{c.criterio || "Escolha…"}{c.criterio ? " (não existe)" : ""}</option>}
                {criterios.map((x) => <option key={x.id} value={x.id}>{x.nome}{x.habilitado ? "" : " (desabilitado)"}</option>)}
              </select>
            </label>
            <fieldset className="min-w-0 flex-1 border-0 p-0" disabled={desabilitado}>
              <legend className="mu p-0">Opções</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {opcoes.map((o, n) => {
                  const marcada = c.opcoes.includes(o);
                  const existe = doCriterio.includes(o);
                  return (
                    <label key={o} htmlFor={`${cid}_o${n}`} className="flex items-center gap-1">
                      <input
                        id={`${cid}_o${n}`} type="checkbox" checked={marcada}
                        onChange={(e) => setCond(j, { ...c, opcoes: e.target.checked ? [...c.opcoes, o] : c.opcoes.filter((x) => x !== o) })}
                      />
                      {o}{!existe && <span className="mu"> (não existe)</span>}
                    </label>
                  );
                })}
                {opcoes.length === 0 && <span className="mu">Escolha um critério.</span>}
              </div>
            </fieldset>
            <button type="button" disabled={desabilitado} onClick={() => onChange({ ...r, cond: r.cond.filter((_, i) => i !== j) })}>Remover condição</button>
          </div>
        );
      })}
      <button type="button" disabled={desabilitado || criterios.length === 0} onClick={() => set({ cond: [...r.cond, { criterio: criterios.find((x) => !r.cond.some((c) => c.criterio === x.id))?.id ?? criterios[0]?.id ?? "", opcoes: [] }] })}>
        Adicionar condição
      </button>
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
      {regras.length === 0 && <p className="mu">Nenhuma regra: a prioridade depende só da pontuação.</p>}
      {regras.map((r, i) => (
        <RegraCard
          key={r.id} r={r} criterios={criterios} desabilitado={desabilitado}
          onChange={(nova) => onChange(regras.map((x, n) => (n === i ? nova : x)))}
          onRemover={() => onChange(regras.filter((_, n) => n !== i))}
        />
      ))}
      <p>
        <button type="button" disabled={desabilitado || criterios.length === 0} onClick={() => onChange([...regras, regraEmBranco()])}>Adicionar regra</button>
      </p>
    </>
  );
}
