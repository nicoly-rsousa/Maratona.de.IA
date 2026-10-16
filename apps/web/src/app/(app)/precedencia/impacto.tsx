"use client";

import Link from "next/link";
import { CODIGOS, type ImpactoRegras } from "@farol/shared";
import { Pill } from "@/components/ui";

const LIMITE = 200;

/** Resultado da pré-visualização: quantas OS abertas mudariam de código ou nível, antes e depois. */
export function Impacto({ impacto: i }: { impacto: ImpactoRegras }) {
  const mostradas = i.mudancas.slice(0, LIMITE);
  return (
    <div className="box" aria-label="Impacto nas OS abertas">
      <h3 className="mt-0">Impacto nas OS abertas</h3>
      <p>
        <b className="m">{i.mudaram}</b> de <b className="m">{i.total}</b> OS abertas mudariam
        {i.mudaram > 0 && (
          <>
            : <b className="m">{i.codigoMudou}</b> de código (<span className="m">{i.sobemCodigo}</span> sobem, <span className="m">{i.descemCodigo}</span> descem)
            e <b className="m">{i.nivelMudou}</b> de nível <span className="mu">(uma OS pode mudar nos dois)</span>
          </>
        )}
        .
      </p>
      {i.semVersao > 0 && (
        <div className="warn">{i.semVersao} OS sem versão de pontuação aplicável ficaram fora da previsão.</div>
      )}

      <div className="tw">
        <table className="tabela">
          <thead>
            <tr><th>OS por código</th>{CODIGOS.map((_, cod) => <th key={cod}><Pill codigo={cod} /></th>)}</tr>
          </thead>
          <tbody>
            <tr><th scope="row">Antes</th>{i.distribuicao.antes.map((n, cod) => <td key={cod} className="m">{n}</td>)}</tr>
            <tr><th scope="row">Depois</th>{i.distribuicao.depois.map((n, cod) => (
              <td key={cod} className="m">{n}{n !== i.distribuicao.antes[cod] && <span className="mu"> ({n - i.distribuicao.antes[cod]! > 0 ? "+" : ""}{n - i.distribuicao.antes[cod]!})</span>}</td>
            ))}</tr>
          </tbody>
        </table>
      </div>

      {i.mudaram === 0 ? (
        <p className="mu">Nenhuma OS aberta muda de código ou nível. A nova versão vale para as OS novas.</p>
      ) : (
        <>
          <h3>OS que mudam</h3>
          <div className="tw">
            <table className="tabela">
              <thead>
                <tr><th>OS</th><th>Cidade</th><th>Antes</th><th>Depois</th><th>Regras aplicadas (antes → depois)</th></tr>
              </thead>
              <tbody>
                {mostradas.map((m) => (
                  <tr key={m.osId} className="r">
                    <td><Link href={`/os/${m.osId}`} className="os-bt m" target="_blank">{m.numero}</Link></td>
                    <td>{m.cidade}</td>
                    <td><Pill codigo={m.antes.codigo} /> <span className="m">nível {m.antes.nivel}</span></td>
                    <td><Pill codigo={m.depois.codigo} /> <span className="m">nível {m.depois.nivel}</span></td>
                    <td className="m whitespace-normal">{m.antes.regras.join(", ") || "—"} → {m.depois.regras.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {i.mudancas.length > LIMITE && <p className="mu">Mostrando as primeiras {LIMITE} de {i.mudancas.length} OS que mudam.</p>}
        </>
      )}
    </div>
  );
}
