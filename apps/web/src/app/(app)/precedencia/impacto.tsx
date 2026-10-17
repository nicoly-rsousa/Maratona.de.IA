"use client";

import { CODIGOS, type ImpactoRegras } from "@farol/shared";
import { Alerta } from "@/components/alerta";
import { LinkExterno } from "@/components/link-externo";
import { Pill } from "@/components/prioridade";
import { Tabela } from "@/components/tabela";

const LIMITE = 200;

/** Resultado da pré-visualização: quantas OS abertas mudariam de código ou nível, antes e depois. */
export function Impacto({ impacto: i }: { impacto: ImpactoRegras }) {
  const mostradas = i.mudancas.slice(0, LIMITE);
  return (
    <section className="card" aria-labelledby="impacto-titulo">
      <h3 id="impacto-titulo" className="card__title">Impacto nas OS abertas</h3>
      <p>
        <b className="font-mono">{i.mudaram}</b> de <b className="font-mono">{i.total}</b> OS abertas mudariam
        {i.mudaram > 0 && (
          <>
            : <b className="font-mono">{i.codigoMudou}</b> de código (<span className="font-mono">{i.sobemCodigo}</span> sobem, <span className="font-mono">{i.descemCodigo}</span> descem)
            e <b className="font-mono">{i.nivelMudou}</b> de nível <span className="text-muted">(uma OS pode mudar nos dois)</span>
          </>
        )}
        .
      </p>
      {i.semVersao > 0 && (
        <Alerta tipo="warning">{i.semVersao} OS sem versão de pontuação aplicável ficaram fora da previsão.</Alerta>
      )}

      <Tabela legenda="Distribuição das OS abertas por código, antes e depois" compacta>
        <thead>
          <tr><th scope="col">OS por código</th>{CODIGOS.map((_, cod) => <th key={cod} scope="col"><Pill codigo={cod} /></th>)}</tr>
        </thead>
        <tbody>
          <tr><th scope="row">Antes</th>{i.distribuicao.antes.map((n, cod) => <td key={cod} className="data-table__cell--num">{n}</td>)}</tr>
          <tr><th scope="row">Depois</th>{i.distribuicao.depois.map((n, cod) => (
            <td key={cod} className="data-table__cell--num">{n}{n !== i.distribuicao.antes[cod] && <span className="text-muted"> ({n - i.distribuicao.antes[cod]! > 0 ? "+" : ""}{n - i.distribuicao.antes[cod]!})</span>}</td>
          ))}</tr>
        </tbody>
      </Tabela>

      {i.mudaram === 0 ? (
        <p className="text-muted">Nenhuma OS aberta muda de código ou nível. A nova versão vale para as OS novas.</p>
      ) : (
        <>
          <h4 className="page__section-title">OS que mudam</h4>
          <Tabela legenda="OS que mudam de código ou nível">
            <thead>
              <tr><th scope="col">OS</th><th scope="col">Cidade</th><th scope="col">Antes</th><th scope="col">Depois</th><th scope="col">Regras aplicadas (antes → depois)</th></tr>
            </thead>
            <tbody>
              {mostradas.map((m) => (
                <tr key={m.osId} className="data-table__row--interactive">
                  <td><LinkExterno href={`/os/${m.osId}`} className="link link--chip">{m.numero}</LinkExterno></td>
                  <td>{m.cidade}</td>
                  <td><Pill codigo={m.antes.codigo} /> <span className="font-mono">nível {m.antes.nivel}</span></td>
                  <td><Pill codigo={m.depois.codigo} /> <span className="font-mono">nível {m.depois.nivel}</span></td>
                  <td className="data-table__cell--wrap font-mono">{m.antes.regras.join(", ") || "—"} → {m.depois.regras.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </Tabela>
          {i.mudancas.length > LIMITE && <p className="text-muted">Mostrando as primeiras {LIMITE} de {i.mudancas.length} OS que mudam.</p>}
        </>
      )}
    </section>
  );
}
