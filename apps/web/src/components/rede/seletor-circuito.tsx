"use client";

import { useId, useState } from "react";
import type { CircuitoResumo } from "@/lib/rede-api";
import { buscarCircuitos } from "@/lib/rede-circuito";
import { formatarClientes } from "@/lib/rede";
import { Carregando } from "@/components/ui";
import { ErroRede } from "./estados";

const MAX = 30;

/** Busca de circuito por trecho do código (ignora espaço, hífen e caixa: "cetlum2" acha "CET-LUM 2" e "CET-LUM2"). */
export function SeletorCircuito({
  circuitos, carregando, erro, selecionado, onSelecionar, onRetry,
}: {
  circuitos: readonly CircuitoResumo[] | undefined;
  carregando: boolean;
  erro: unknown;
  selecionado: string | null;
  onSelecionar: (codigo: string | null) => void;
  onRetry: () => void;
}) {
  const [termo, setTermo] = useState("");
  const id = useId();
  if (carregando) return <section className="box"><Carregando texto="Carregando a lista de alimentadores…" /></section>;
  if (erro) return <section className="box"><ErroRede erro={erro} titulo="Não foi possível carregar os alimentadores." onRetry={onRetry} /></section>;
  const lista = circuitos ?? [];
  const achados = buscarCircuitos(lista, termo, MAX);
  const totalAchados = termo.trim() === "" ? lista.length : buscarCircuitos(lista, termo, lista.length).length;
  return (
    <section className="box rede-selector" aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`} style={{ marginTop: 0 }}>Alimentador</h3>
      <label className="row" style={{ display: "block" }}>
        <span className="mu">Buscar entre {lista.length.toLocaleString("pt-BR")} alimentadores</span>
        <input type="search" value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="ex.: LPD-1, cet lum 2" style={{ width: "100%" }} />
      </label>
      <p className="mu" role="status" aria-live="polite" style={{ margin: "4px 0" }}>
        {achados.length === 0
          ? "Nenhum alimentador encontrado."
          : totalAchados > achados.length
            ? `Mostrando ${achados.length} de ${totalAchados.toLocaleString("pt-BR")}: refine a busca.`
            : `${achados.length} alimentador${achados.length === 1 ? "" : "es"}.`}
      </p>
      <ul className="circuit-list">
        {achados.map((c) => (
          <li key={c.codigo}>
            <button
              type="button" aria-pressed={c.codigo === selecionado} onClick={() => onSelecionar(c.codigo === selecionado ? null : c.codigo)}
              className="circuit-option"
            >
              <span className="m circuit-code">{c.codigo}</span>
              <span className="mu circuit-meta">
                {c.qtd_os.toLocaleString("pt-BR")} OS · clientes: {formatarClientes(c.clientes_total)}{c.tem_tracado ? " · traçado" : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
