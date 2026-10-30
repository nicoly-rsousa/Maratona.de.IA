import type { CSSProperties } from "react";
import type { Contorno } from "@farol/shared";
import type { FeicaoChave, FeicaoLinha } from "@/lib/rede-api";
import { legendaDeChaves } from "@/lib/rede";
import { ROTULO_CONTORNO_APROXIMADO, legendaDoTracado } from "@/lib/rede-circuito";

const n = (v: number) => v.toLocaleString("pt-BR");
const bolinha = (cor: string, extra: CSSProperties = {}): CSSProperties =>
  ({ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: cor, border: "1.5px solid #fff", boxShadow: "0 0 0 1px #0006", marginRight: 6, flex: "none", ...extra });
const linha = (cor: string): CSSProperties => ({ display: "inline-block", width: 22, height: 0, borderTop: `4px solid ${cor}`, marginRight: 6, flex: "none" });
const item: CSSProperties = { display: "flex", alignItems: "center", padding: "2px 0" };

/** Legenda do alimentador selecionado: traçado por trecho, chaves pelo NOME do tipo, transformador e contorno aproximado. */
export function LegendaCircuito({
  tracado, chaves, coresChaves, contorno, qtdTransformadoresNoMapa,
}: {
  tracado: readonly FeicaoLinha[];
  chaves: readonly FeicaoChave[];
  coresChaves: Readonly<Record<string, string>>;
  contorno: Contorno | null;
  qtdTransformadoresNoMapa: number;
}) {
  const trechos = legendaDoTracado(tracado);
  const tipos = legendaDeChaves(chaves as FeicaoChave[]);
  return (
    <section className="box rede-circuit-legend" aria-labelledby="legenda-circuito-titulo">
      <h3 id="legenda-circuito-titulo" style={{ marginTop: 0 }}>Legenda do alimentador</h3>
      {trechos.length > 0 && (
        <>
          <h4 style={{ margin: "0 0 2px", fontSize: 13 }}>Traçado (cor pelo trecho)</h4>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {trechos.map((t) => (
              <li key={String(t.trecho)} style={item}>
                <span aria-hidden="true" style={linha(t.cor)} />
                <span>{t.rotulo}</span>
                <span className="mu" style={{ marginLeft: "auto", paddingLeft: 8 }}>
                  {n(t.qtd)} segmentos{t.baixaTensao > 0 ? ` (${n(t.baixaTensao)} de baixa tensão)` : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {tipos.length > 0 && (
        <>
          <h4 style={{ margin: "8px 0 2px", fontSize: 13 }}>Chaves (por tipo)</h4>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {tipos.map((t) => (
              <li key={t.nome} style={item}>
                <span aria-hidden="true" style={bolinha(coresChaves[t.nome] ?? "#111111")} />
                <span>{t.nome}</span>
                <span className="mu" style={{ marginLeft: "auto", paddingLeft: 8 }}>{n(t.qtd)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {qtdTransformadoresNoMapa > 0 && (
        <>
          <h4 style={{ margin: "8px 0 2px", fontSize: 13 }}>Transformadores</h4>
          <div style={item}>
            <span aria-hidden="true" style={bolinha("var(--p1)", { width: 18, height: 18, border: "2px solid var(--ac)" })} />
            <span>Círculo com o nº de clientes identificados</span>
          </div>
        </>
      )}
      {contorno?.tipo === "poligono" && (
        <div style={{ ...item, marginTop: 8 }}>
          <span aria-hidden="true" style={{ display: "inline-block", width: 22, height: 0, borderTop: "2px dashed var(--ac)", marginRight: 6, flex: "none" }} />
          <span>{ROTULO_CONTORNO_APROXIMADO}</span>
        </div>
      )}
    </section>
  );
}
