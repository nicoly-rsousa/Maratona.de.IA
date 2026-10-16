"use client";

import { useState } from "react";
import type { ConteudoPontuacao } from "@farol/shared";
import { Pill } from "@/components/ui";

interface NumeroProps {
  valor: number | null;
  /** Texto do campo vazio (ex.: "sem pontos", "sem limite"). Sem ele o campo não aceita vazio. */
  vazio?: string;
  rotulo: string;
  desabilitado: boolean;
  /** Campo vazio é erro (pontos sem definição): destaca em vermelho. */
  destacarVazio?: boolean;
  onMudar: (v: number | null) => void;
}

/** Campo de inteiro ≥ 0. Vazio vira `null` (nunca 0): "sem pontos definidos" é diferente de zero (§3). */
function Numero({ valor, vazio, rotulo, desabilitado, destacarVazio, onMudar }: NumeroProps) {
  const [t, setT] = useState(valor == null ? "" : String(valor));
  return (
    <input
      className={`m w-[84px] ${destacarVazio && t === "" ? "border-c1" : ""}`}
      inputMode="numeric"
      value={t}
      placeholder={vazio}
      disabled={desabilitado}
      aria-label={rotulo}
      aria-invalid={destacarVazio && t === ""}
      onChange={(e) => {
        const s = e.target.value;
        if (!/^\d{0,9}$/.test(s)) return;
        setT(s);
        if (s !== "") onMudar(Number(s));
        else if (vazio !== undefined) onMudar(null);
      }}
      onBlur={() => { if (t === "" && vazio === undefined && valor != null) setT(String(valor)); }}
    />
  );
}

interface Props {
  conteudo: ConteudoPontuacao;
  /** Aplica a alteração sobre uma cópia do conteúdo. */
  onEditar: (alterar: (c: ConteudoPontuacao) => void) => void;
  somenteLeitura: boolean;
}

/** Critérios (habilitar, agregação, pontos, "requer confirmação", opção desconhecida) e faixas → código (vPont do protótipo). */
export function Editor({ conteudo, onEditar, somenteLeitura }: Props) {
  return (
    <>
      <p className="mu">Campo de pontos vazio = <b>sem pontos definidos</b> (não é zero) e bloqueia a publicação.</p>
      <div className="tw">
        <table className="tabela">
          <thead>
            <tr><th>Opção</th><th>Pontos</th><th>Requer confirmação</th><th>Desconhecida</th></tr>
          </thead>
          {conteudo.criterios.map((c, ci) => (
            <tbody key={c.id} className={c.habilitado ? "" : "opacity-60"}>
              <tr className="bg-p2">
                <td colSpan={4}>
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={c.habilitado}
                      disabled={somenteLeitura}
                      onChange={(e) => { const v = e.target.checked; onEditar((d) => { d.criterios[ci]!.habilitado = v; }); }}
                    />
                    <b>{c.nome}</b>
                  </label>
                  <span className="mu m"> {c.id}</span>
                  <label className="mu ml-3">
                    Agregação{" "}
                    <select
                      value={c.agregacao}
                      disabled={somenteLeitura}
                      onChange={(e) => { const v = e.target.value as "soma" | "max"; onEditar((d) => { d.criterios[ci]!.agregacao = v; }); }}
                    >
                      <option value="soma">soma</option>
                      <option value="max">máximo</option>
                    </select>
                  </label>
                  {!c.habilitado && <span className="mu"> · desabilitado: não pontua e não é perguntado</span>}
                </td>
              </tr>
              {c.opcoes.map((o, oi) => (
                <tr key={o.label}>
                  <td>{o.label}</td>
                  <td>
                    <Numero
                      valor={o.pontos}
                      vazio="sem pontos"
                      destacarVazio={c.habilitado}
                      rotulo={`${c.nome}: pontos de "${o.label}"`}
                      desabilitado={somenteLeitura}
                      onMudar={(v) => onEditar((d) => { d.criterios[ci]!.opcoes[oi]!.pontos = v; })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={o.requerConfirmacao}
                      disabled={somenteLeitura}
                      aria-label={`${c.nome}: "${o.label}" requer confirmação`}
                      onChange={(e) => { const v = e.target.checked; onEditar((d) => { d.criterios[ci]!.opcoes[oi]!.requerConfirmacao = v; }); }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={o.desconhecida}
                      disabled={somenteLeitura}
                      aria-label={`${c.nome}: "${o.label}" é a opção desconhecida`}
                      onChange={(e) => {
                        const v = e.target.checked;
                        // uma só opção "desconhecida" por critério: é para ela que o fato não informado cai
                        onEditar((d) => { d.criterios[ci]!.opcoes.forEach((x, k) => { x.desconhecida = v && k === oi; }); });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <h3>Faixas → código</h3>
      <div className="tw">
        <table className="tabela !w-auto">
          <thead><tr><th>De</th><th>Até (vazio = sem limite)</th><th className="!text-center">Código</th></tr></thead>
          <tbody>
            {conteudo.faixas.map((f, i) => (
              <tr key={i}>
                <td>
                  <Numero valor={f.de} rotulo="Faixa: de" desabilitado={somenteLeitura}
                    onMudar={(v) => onEditar((d) => { d.faixas[i]!.de = v ?? 0; })} />
                </td>
                <td>
                  <Numero valor={f.ate} vazio="sem limite" rotulo="Faixa: até" desabilitado={somenteLeitura}
                    onMudar={(v) => onEditar((d) => { d.faixas[i]!.ate = v; })} />
                </td>
                <td className="!text-center"><Pill codigo={f.cod} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
