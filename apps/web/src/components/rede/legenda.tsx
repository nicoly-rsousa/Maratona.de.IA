import type { CSSProperties } from "react";
import { COR_SEM_MAPA, LEGENDA_INFORMATIVA, legendaDePrioridades, semCircuitoIdentificado, type ChavePrioridade } from "@/lib/rede";
import type { OSRedeLeve } from "@/lib/rede-api";

/** Amostra da legenda: mesmas regras visuais do mapa (cheio = classe; tracejado = sem mapa; anel vazado = circuito não identificado). */
function amostra(chave: ChavePrioridade | "anel"): CSSProperties {
  const base: CSSProperties = { display: "inline-block", width: 14, height: 14, borderRadius: "50%", verticalAlign: "-2px", marginRight: 6, flex: "none" };
  if (chave === "anel") return { ...base, background: "transparent", border: "3px solid var(--tx)" };
  if (chave === "sem-mapa") return { ...base, background: COR_SEM_MAPA, border: "2px dashed #444" };
  return { ...base, background: `var(--${chave})`, border: "1.5px solid var(--bg)" };
}

const n = (v: number) => v.toLocaleString("pt-BR");

/** Legenda da visão geral: contagem por classe (informativa, não é a fila do Farol), "sem mapa" e anel vazado. */
export function Legenda({ os }: { os: readonly OSRedeLeve[] }) {
  const itens = legendaDePrioridades(os);
  const semCirc = semCircuitoIdentificado(os).length;
  return (
    <section className="box" aria-labelledby="rede-legenda-titulo">
      <h3 id="rede-legenda-titulo" style={{ marginTop: 0 }}>{LEGENDA_INFORMATIVA}</h3>
      <ul className="m-0 list-none p-0" style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {itens.map((i) => (
          <li key={i.chave} style={{ display: "flex", alignItems: "center", padding: "2px 0" }}>
            <span aria-hidden="true" style={amostra(i.chave)} />
            <span>{i.rotulo}</span>
            <span className="mu" style={{ marginLeft: "auto", paddingLeft: 8 }}>{n(i.qtd)} OS</span>
          </li>
        ))}
        <li style={{ display: "flex", alignItems: "center", padding: "6px 0 2px", borderTop: "1px solid var(--ln)", marginTop: 4 }}>
          <span aria-hidden="true" style={amostra("anel")} />
          <span>Anel vazado: circuito não identificado</span>
          <span className="mu" style={{ marginLeft: "auto", paddingLeft: 8 }}>{n(semCirc)} OS</span>
        </li>
      </ul>
      <p className="mu" style={{ marginBottom: 0 }}>
        Contorno tracejado = sem mapa de prioridade (nunca é tratado como risco zero). Cores informativas; a fila de prioridade do Farol não muda.
      </p>
    </section>
  );
}
