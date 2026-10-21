"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  COLUNAS_IMPORTACAO, type LinhaImportacaoValida, type MotivoDuplicidade, type NovaOS, type ResultadoImportacaoCsv,
} from "@farol/shared";
import { apiPost } from "@/lib/api";
import type { ImportacaoConfirmada } from "@/lib/types";
import { ErroAcao, Pill } from "@/components/ui";
import { ImportacaoPendentes } from "@/components/importar/importacao-pendentes";
import { useApp } from "../../app-context";

const MOTIVO: Record<MotivoDuplicidade, string> = {
  proximidade: "próxima",
  mesmo_transformador: "mesmo transformador",
  mesma_uc: "mesma UC",
  mesmo_conjunto_e_tipo: "mesmo conjunto e tipo",
};

/** Colunas do modelo: todas as de COLUNAS_IMPORTACAO, exceto `cidade` — ela vem da seleção acima, nunca da planilha. */
const COLUNAS_MODELO = COLUNAS_IMPORTACAO.filter((c) => c !== "cidade");

/** Modelo baixável: cabeçalho esperado + uma linha de exemplo (mesma quantidade de campos do cabeçalho). */
function baixarModelo() {
  const linhas = [COLUNAS_MODELO.join(","), "Rua das Flores 100,,,1234,2010002,,,,Corretiva,"];
  const blob = new Blob([linhas.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "farol-modelo-importacao.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/** Modelo simples (um município para todas as linhas, endereço obrigatório): o fluxo que já existia. */
function ImportacaoSimples() {
  const { ator, cidades, cidade: cidadeHeader } = useApp();
  const qc = useQueryClient();
  const podeNova = ator.permissoes.includes("nova");

  const [cidadeSel, setCidadeSel] = useState<string>("");
  const cidade = cidades.some((c) => c.id === cidadeSel) ? cidadeSel : cidades.some((c) => c.id === cidadeHeader) ? cidadeHeader : (cidades[0]?.id ?? "");

  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [csvTexto, setCsvTexto] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacaoCsv | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [confirmado, setConfirmado] = useState<ImportacaoConfirmada | null>(null);

  async function escolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo depois de corrigi-lo
    if (!arquivo) return;
    setNomeArquivo(arquivo.name);
    setCsvTexto(await arquivo.text());
    setResultado(null);
    setConfirmado(null);
  }

  const prever = useMutation({
    mutationFn: () => apiPost<ResultadoImportacaoCsv>("/os/importar/preview", { cidade, csv: csvTexto }),
    onSuccess: (r) => {
      setResultado(r);
      setConfirmado(null);
      // por padrão, marca para importar toda linha válida SEM duplicidade suspeita; duplicidade exige decisão explícita.
      setSelecionadas(new Set(r.linhas.filter((l): l is LinhaImportacaoValida => l.status === "valida" && l.duplicidade.length === 0).map((l) => l.linha)));
    },
  });

  const confirmar = useMutation({
    mutationFn: () => {
      const validas = (resultado?.linhas ?? []).filter((l): l is LinhaImportacaoValida => l.status === "valida");
      const itens = validas.filter((l) => selecionadas.has(l.linha)).map((l) => ({ linha: l.linha, dados: l.dados as NovaOS }));
      return apiPost<ImportacaoConfirmada>("/os/importar/confirmar", { cidade, itens });
    },
    onSuccess: (r) => { setConfirmado(r); qc.invalidateQueries({ queryKey: ["fila"] }); },
  });

  const linhasValidas = useMemo(() => (resultado?.linhas ?? []).filter((l): l is LinhaImportacaoValida => l.status === "valida"), [resultado]);
  const totalSelecionadas = linhasValidas.filter((l) => selecionadas.has(l.linha)).length;

  function alternar(linha: number) {
    setSelecionadas((s) => {
      const n = new Set(s);
      if (n.has(linha)) n.delete(linha); else n.add(linha);
      return n;
    });
  }

  if (!podeNova) {
    return <div className="err" role="alert"><b>Sem permissão.</b> O perfil {ator.perfil} não registra solicitações.</div>;
  }
  if (cidades.length === 0) {
    return <div className="warn">Seu usuário não tem cidade vinculada. Peça a um administrador para vinculá-lo a um município.</div>;
  }

  return (
    <>
      <h2>Importar OS de um arquivo CSV</h2>
      <div className="box">
        <p className="mu">
          Cada linha do arquivo passa pelas MESMAS regras do formulário: campos obrigatórios, formato de UC e transformador, e a
          sugestão de duplicidade (§11) — nunca automática. Nada é gravado até você conferir a prévia e confirmar.
        </p>
        <div className="row">
          <label htmlFor="imp_cid">
            Município (vale para todas as linhas do arquivo)
            <select id="imp_cid" value={cidade} onChange={(e) => { setCidadeSel(e.target.value); setResultado(null); setConfirmado(null); }}>
              {cidades.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
        </div>

        <div className="row">
          <label htmlFor="imp_arq">
            Arquivo .csv
            <input id="imp_arq" type="file" accept=".csv,text/csv" onChange={escolherArquivo} />
          </label>
          <button type="button" onClick={baixarModelo}>Baixar modelo .csv</button>
        </div>
        {nomeArquivo && <p className="mu">Selecionado: <b className="m">{nomeArquivo}</b></p>}

        <button className="pr" disabled={!csvTexto || cidade === "" || prever.isPending} onClick={() => prever.mutate()}>
          {prever.isPending ? "Lendo o arquivo…" : "Pré-visualizar"}
        </button>
        {prever.isError && <ErroAcao erro={prever.error} />}

        {resultado && (
          <>
            <h3>Prévia</h3>
            <p className="mu">
              {resultado.totalLinhas} linha(s) · <b className="m">{resultado.totalValidas}</b> prontas para importar
              {resultado.totalComDuplicidadeSuspeita > 0 && <> · <b className="m">{resultado.totalComDuplicidadeSuspeita}</b> com possível duplicidade</>}
              {resultado.totalComErro > 0 && <> · <b className="m">{resultado.totalComErro}</b> com erro</>}
            </p>
            {resultado.totalLinhas === 0 && <div className="warn">Nenhuma linha de dados encontrada no arquivo (só o cabeçalho?).</div>}

            <div className="tw">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Importar</th><th>Linha</th><th>Endereço</th><th>UC</th><th>Transformador</th><th>Tipo</th><th>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.linhas.map((l) => {
                    if (l.status === "erro") {
                      return (
                        <tr key={l.linha}>
                          <td className="m">—</td>
                          <td className="m">{l.linha}</td>
                          <td colSpan={5} className="err">{l.erros.join(" ")}</td>
                        </tr>
                      );
                    }
                    const d = l.dados;
                    const marcada = selecionadas.has(l.linha);
                    return (
                      <tr key={l.linha}>
                        <td><input type="checkbox" checked={marcada} onChange={() => alternar(l.linha)} aria-label={`Importar linha ${l.linha}`} /></td>
                        <td className="m">{l.linha}</td>
                        <td>{d.endereco}</td>
                        <td className="m">{d.uc ?? "—"}</td>
                        <td className="m">{d.transformador ?? "—"}</td>
                        <td>{d.tipo}</td>
                        <td>
                          {l.duplicidade.length === 0 ? (
                            <span className="mu">sem indício de duplicidade</span>
                          ) : (
                            <div className="warn" role="alert">
                              <b>Possível duplicidade.</b>{" "}
                              {l.duplicidade.map((s) => (
                                <span key={s.id} className="m">
                                  {s.id.startsWith("linha-") ? (
                                    <>linha {s.numero.replace("linha ", "")} deste arquivo</>
                                  ) : (
                                    <Link href={`/os/${s.id}`} target="_blank" className="text-ac underline">{s.numero}</Link>
                                  )}
                                  {" "}({s.motivos.map((m) => MOTIVO[m]).join(", ")})
                                </span>
                              )).reduce((a, b) => <>{a}; {b}</>)}
                              {" — confira antes de marcar \"Importar\"."}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <button className="pr" disabled={totalSelecionadas === 0 || confirmar.isPending} onClick={() => confirmar.mutate()}>
              {confirmar.isPending ? "Importando…" : `Confirmar importação (${totalSelecionadas})`}
            </button>
            {confirmar.isError && <ErroAcao erro={confirmar.error} />}
          </>
        )}

        {confirmado && (
          <div className="okm" role="status">
            <b>{confirmado.criadas.length}</b> OS criada(s).
            {confirmado.criadas.length > 0 && (
              <ul>
                {confirmado.criadas.map((c) => (
                  <li key={c.id}>linha {c.linha}: <Link href={`/os/${c.id}`} className="m text-ac underline">{c.numero}</Link></li>
                ))}
              </ul>
            )}
            {confirmado.erros.length > 0 && (
              <div className="err" role="alert">
                <b>{confirmado.erros.length}</b> linha(s) não puderam ser criadas:
                <ul>
                  {confirmado.erros.map((e) => <li key={e.linha}>linha {e.linha}: {e.mensagem}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

type Modelo = "pendentes" | "simples";

/**
 * Importar OS de um arquivo CSV. O PADRÃO é o formato da planilha "OS manutenção pendente" (cadastro em lote com campos opcionais).
 * Esse modelo cria cidades (uma por município), então é do Administrador; os demais perfis ficam com o modelo simples.
 */
export default function ImportarCsvPage() {
  const { ator } = useApp();
  const pendentesLiberado = ator.todasCidades && ator.permissoes.includes("nova");
  const [modelo, setModelo] = useState<Modelo>(pendentesLiberado ? "pendentes" : "simples");
  const atual: Modelo = modelo === "pendentes" && !pendentesLiberado ? "simples" : modelo;
  return (
    <>
      <p className="mu">
        <Link href="/nova" className="text-ac underline">← Voltar para Nova solicitação (uma por vez)</Link>
      </p>
      <fieldset className="box" style={{ marginBottom: 10 }}>
        <legend>Modelo do arquivo</legend>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="radio" name="modelo-importacao" checked={atual === "pendentes"} disabled={!pendentesLiberado} onChange={() => setModelo("pendentes")} />
          <span><b>OS manutenção pendente</b> (padrão): município vem da Localidade, só número da OS e município são obrigatórios</span>
        </label>
        {!pendentesLiberado && (
          <p className="mu" style={{ margin: "2px 0 6px 22px" }}>Disponível só para o Administrador: esse modelo cria uma cidade por município.</p>
        )}
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="radio" name="modelo-importacao" checked={atual === "simples"} onChange={() => setModelo("simples")} />
          <span><b>Modelo simples</b>: um município para o arquivo todo e endereço obrigatório</span>
        </label>
      </fieldset>
      {atual === "pendentes" ? <ImportacaoPendentes /> : <ImportacaoSimples />}
    </>
  );
}
