"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CAMPOS_OS_PENDENTE, CODIGOS, type CodigoAviso, type Tabela } from "@farol/shared";
import { ApiError } from "@/lib/api";
import {
  ACUMULADO_ZERO, TEXTO_AVISO, TEXTO_ORIGEM_ENDERECO, conteudoDasRejeitadas, confirmarLote, lerArquivo, lotesDaImportacao, prepararCsv, previaImportacao,
  somarLote, type Acumulado, type PreviaOSPendente,
} from "@/lib/importar-pendentes";
import { Carregando, ErroAcao } from "@/components/ui";

const n = (v: number) => v.toLocaleString("pt-BR");

function baixarRejeitadas(p: PreviaOSPendente) {
  const blob = new Blob([conteudoDasRejeitadas(p.rejeitadas)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "farol-os-rejeitadas.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Cadastro de OS por arquivo no formato "OS manutenção pendente" (CSV). Fluxo: escolher arquivo → prévia (nada é gravado) → importar em
 * lotes (atômicos e idempotentes). Só as colunas reconhecidas saem do navegador. Campos vazios são opcionais; só número da OS e município
 * (da Localidade) são obrigatórios.
 */
export function ImportacaoPendentes() {
  const qc = useQueryClient();
  const [arquivo, setArquivo] = useState<{ nome: string; tabela: Tabela; totalLinhas: number; ignoradas: string[] } | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [previa, setPrevia] = useState<PreviaOSPendente | null>(null);

  const [importando, setImportando] = useState(false);
  const [feitos, setFeitos] = useState(0); // lotes concluídos (é daqui que "Retomar" continua)
  const [totalLotes, setTotalLotes] = useState(0);
  const [acum, setAcum] = useState<Acumulado>(ACUMULADO_ZERO);
  const [erroImport, setErroImport] = useState<unknown>(null);
  const [cancelado, setCancelado] = useState(false);
  const cancelar = useRef(false);

  async function escolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setLendo(true); setErroArquivo(null); setArquivo(null); setPrevia(null); setAcum(ACUMULADO_ZERO); setFeitos(0); setTotalLotes(0); setErroImport(null); setCancelado(false);
    try {
      const r = prepararCsv(await lerArquivo(f));
      if (!r.ok) setErroArquivo(r.erro);
      else setArquivo({ nome: f.name, tabela: r.tabela, totalLinhas: r.totalLinhas, ignoradas: r.ignoradas });
    } catch (err) {
      setErroArquivo((err as Error).message);
    } finally {
      setLendo(false);
    }
  }

  const prever = useMutation({
    mutationFn: (tabela: Tabela) => previaImportacao(tabela),
    onSuccess: (p) => { setPrevia(p); setAcum(ACUMULADO_ZERO); setFeitos(0); setTotalLotes(0); setErroImport(null); setCancelado(false); },
  });

  /** Confirma lote a lote a partir de `inicio`. Falha = para e mostra o erro; "Retomar" continua do lote que falhou (a gravação é idempotente). */
  async function importar(inicio: number, base: Acumulado) {
    if (!arquivo || !previa) return;
    const lotes = lotesDaImportacao(arquivo.tabela, previa.entramLinhas, previa.tamanhoLote);
    setTotalLotes(lotes.length); setImportando(true); setErroImport(null); setCancelado(false); cancelar.current = false;
    let ac = base;
    for (let i = inicio; i < lotes.length; i++) {
      if (cancelar.current) { setCancelado(true); setImportando(false); return; }
      try {
        ac = somarLote(ac, await confirmarLote(lotes[i]!));
      } catch (e) {
        setErroImport(e); setImportando(false);
        return;
      }
      setAcum(ac); setFeitos(i + 1);
    }
    setImportando(false);
    void qc.invalidateQueries({ queryKey: ["cidades"] });
    void qc.invalidateQueries({ queryKey: ["fila"] });
  }

  const concluido = totalLotes > 0 && feitos === totalLotes && !importando && !erroImport;
  const andamento = totalLotes > 0 && !concluido;
  const semPermissao = (prever.error instanceof ApiError && prever.error.status === 403) || (erroImport instanceof ApiError && erroImport.status === 403);

  return (
    <>
      <h2>Importar OS no formato &quot;OS manutenção pendente&quot; (CSV)</h2>
      <div className="box">
        <p className="mu" style={{ marginTop: 0 }}>
          Exporte a planilha <b>OS manutenção pendente</b> como <b>CSV</b> (UTF-8 ou Windows-1252, separador ponto e vírgula, vírgula ou tab). Só o <b>número da OS</b> (OSNumero)
          e o <b>município</b> (extraído da Localidade) são obrigatórios; todo o resto é opcional. Campo vazio fica <b>desconhecido</b> (nunca zero). Cada município vira uma
          cidade do Farol. Nada é gravado até você conferir a prévia e confirmar.
        </p>
        <div className="row">
          <label htmlFor="pend_arq">
            Arquivo .csv
            <input id="pend_arq" type="file" accept=".csv,text/csv" onChange={escolherArquivo} />
          </label>
        </div>
        {lendo && <Carregando texto="Lendo o arquivo…" />}
        {erroArquivo && <div className="err" role="alert">{erroArquivo}</div>}
        {arquivo && (
          <div role="status">
            <p className="mu" style={{ marginBottom: 4 }}>
              Selecionado: <b className="m">{arquivo.nome}</b> · {n(arquivo.totalLinhas)} linhas de dados.
            </p>
            <p className="mu" style={{ marginTop: 0 }}>
              Privacidade: só as {n(Object.keys(CAMPOS_OS_PENDENTE).length)} colunas usadas são enviadas ao servidor. As outras{" "}
              <b>{n(arquivo.ignoradas.length)} colunas</b> do arquivo não saem do seu computador.
            </p>
          </div>
        )}
        <button type="button" className="pr" disabled={!arquivo || prever.isPending || importando} onClick={() => { if (arquivo) prever.mutate(arquivo.tabela); }}>
          {prever.isPending ? "Analisando…" : "Pré-visualizar"}
        </button>
        {prever.isError && (semPermissao
          ? <div className="err" role="alert"><b>Sem permissão.</b> O cadastro no formato OS manutenção pendente cria cidades e é do Administrador.</div>
          : <ErroAcao erro={prever.error} />)}
      </div>

      {previa && (
        <div className="box">
          <h3 style={{ marginTop: 0 }}>Prévia</h3>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px" }}>
            <dt className="mu">Linhas lidas</dt><dd style={{ margin: 0 }}>{n(previa.totalLinhas)}</dd>
            <dt className="mu">Entram</dt><dd style={{ margin: 0 }}><b>{n(previa.entram)}</b></dd>
            <dt className="mu">Rejeitadas</dt><dd style={{ margin: 0 }}><b>{n(previa.totalRejeitadas)}</b> (sem número da OS ou sem município, ou número repetido)</dd>
            <dt className="mu">Entram com aviso</dt><dd style={{ margin: 0 }}>{n(previa.comAviso)}</dd>
            <dt className="mu">Sem coordenada</dt><dd style={{ margin: 0 }}>{n(previa.semCoordenada)} (entram &quot;Em triagem&quot;, fora do mapa e da busca por raio)</dd>
            <dt className="mu">Já existentes</dt><dd style={{ margin: 0 }}>{n(previa.jaExistentes)} (não serão duplicadas nem alteradas)</dd>
            <dt className="mu">Cidades</dt>
            <dd style={{ margin: 0 }}>{n(previa.cidades.municipios)} município(s): {n(previa.cidades.existentes)} já são cidades, <b>{n(previa.cidades.novas)} serão criadas</b></dd>
          </dl>

          <h4>Endereço</h4>
          <ul style={{ margin: 0 }}>
            {(Object.keys(TEXTO_ORIGEM_ENDERECO) as (keyof typeof TEXTO_ORIGEM_ENDERECO)[]).map((k) => (
              <li key={k}>{TEXTO_ORIGEM_ENDERECO[k]}: <b>{n(previa.origemEndereco[k])}</b></li>
            ))}
          </ul>

          {previa.colunasAusentes.length > 0 && (
            <div className="warn" role="note">Colunas que não vieram no arquivo (tratadas como vazias): {previa.colunasAusentes.join(", ")}.</div>
          )}

          <h4>Campos vazios por coluna</h4>
          <div className="tw">
            <table className="tabela">
              <caption className="sr-only">Quantidade de linhas com a coluna vazia</caption>
              <thead><tr><th scope="col">Coluna</th><th scope="col">Vazias</th><th scope="col">%</th></tr></thead>
              <tbody>
                {Object.entries(previa.vazios).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([col, v]) => (
                  <tr key={col}><td>{col}</td><td>{n(v)}</td><td>{previa.totalLinhas ? Math.round((100 * v) / previa.totalLinhas) : 0}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          {previa.comAviso > 0 && (
            <>
              <h4>Avisos (a linha entra, o campo fica vazio)</h4>
              <ul style={{ margin: 0 }}>
                {(Object.entries(previa.avisosPorCodigo) as [CodigoAviso, number][]).map(([c, q]) => <li key={c}>{TEXTO_AVISO[c] ?? c}: <b>{n(q)}</b></li>)}
              </ul>
              <details>
                <summary>Ver exemplos ({n(Math.min(previa.avisos.length, 300))})</summary>
                <ul>{previa.avisos.slice(0, 50).map((a, i) => <li key={i}>Linha {a.linha}: {a.mensagem}</li>)}</ul>
              </details>
            </>
          )}

          {previa.totalRejeitadas > 0 && (
            <>
              <h4>Rejeitadas</h4>
              <div className="tw" style={{ maxHeight: 220, overflow: "auto" }}>
                <table className="tabela">
                  <caption className="sr-only">Linhas rejeitadas e o motivo</caption>
                  <thead><tr><th scope="col">Linha</th><th scope="col">Motivo</th></tr></thead>
                  <tbody>{previa.rejeitadas.slice(0, 100).map((r) => <tr key={r.linha}><td>{r.linha}</td><td>{r.motivo}</td></tr>)}</tbody>
                </table>
              </div>
              <button type="button" onClick={() => baixarRejeitadas(previa)}>Baixar arquivo de rejeitadas (.csv)</button>
              {previa.totalRejeitadas > previa.rejeitadas.length && <span className="mu"> O arquivo traz as primeiras {n(previa.rejeitadas.length)} de {n(previa.totalRejeitadas)}.</span>}
              <p className="mu">O arquivo traz só o número da linha, o motivo e as colunas permitidas (sem endereço nem complemento).</p>
            </>
          )}

          <div className="warn" role="note">
            As OS entram na <b>fila do Farol</b> com a prioridade calculada pelas regras do Farol. A planilha não traz as respostas dos critérios de risco, então esses critérios valem
            &quot;Desconhecido&quot; (que pontua, nunca zero): na versão de pontuação atual isso pode colocar todas as OS importadas na mesma faixa. A prioridade legada
            (CodPrioridade), o prazo (DataDeadline) e a quantidade de clientes ficam <b>só como informação</b>.
          </div>

          <h4>Primeiras linhas que entram</h4>
          <div className="tw">
            <table className="tabela">
              <caption className="sr-only">Amostra das primeiras OS que entram</caption>
              <thead><tr><th scope="col">Linha</th><th scope="col">OS</th><th scope="col">Município</th><th scope="col">Endereço</th><th scope="col">Clientes</th></tr></thead>
              <tbody>
                {previa.amostra.map((o) => (
                  <tr key={o.linha}><td>{o.linha}</td><td className="m">{o.numeroOrigem}</td><td>{o.municipio}</td><td>{o.endereco}</td><td>{o.clientes === null ? "desconhecido" : n(o.clientes)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10 }}>
            <button
              type="button" className="pr" disabled={previa.entram === 0 || importando || concluido}
              onClick={() => void importar(0, ACUMULADO_ZERO)}
            >
              {importando ? "Importando…" : `Importar ${n(previa.entram)} OS em lotes de ${n(previa.tamanhoLote)}`}
            </button>
          </div>

          {andamento && (
            <div role="status" aria-live="polite" style={{ marginTop: 8 }}>
              <div role="progressbar" aria-valuemin={0} aria-valuemax={totalLotes} aria-valuenow={feitos} aria-label="Progresso da importação" style={{ height: 10, background: "var(--p2)", border: "1px solid var(--ln)" }}>
                <div style={{ width: `${totalLotes ? (100 * feitos) / totalLotes : 0}%`, height: "100%", background: "var(--ac)" }} />
              </div>
              <p className="mu" style={{ margin: "4px 0" }}>
                Lote {n(Math.min(feitos + (importando ? 1 : 0), totalLotes))} de {n(totalLotes)} · {n(acum.criadas)} criadas, {n(acum.jaExistentes)} já existentes
              </p>
              {importando && <button type="button" onClick={() => { cancelar.current = true; }}>Cancelar (depois do lote atual)</button>}
              {cancelado && (
                <p className="warn" role="note">
                  Importação interrompida depois do lote {n(feitos)} de {n(totalLotes)}. O que já foi gravado fica. <button type="button" onClick={() => void importar(feitos, acum)}>Continuar</button>
                </p>
              )}
            </div>
          )}

          {erroImport != null && (
            <div className="err" role="alert">
              {semPermissao
                ? <><b>Sem permissão.</b> O cadastro no formato OS manutenção pendente é do Administrador.</>
                : <>
                    <b>Falha no lote {n(feitos + 1)} de {n(totalLotes)}.</b> {erroImport instanceof Error ? erroImport.message : "Erro desconhecido."} Nada deste lote foi gravado; os lotes anteriores ficam.{" "}
                    <button type="button" onClick={() => void importar(feitos, acum)}>Retomar do lote {n(feitos + 1)}</button>
                  </>}
            </div>
          )}

          {concluido && (
            <div className="okm" role="status">
              <b>Importação concluída.</b> {n(acum.criadas)} OS criadas, {n(acum.jaExistentes)} já existentes (não duplicadas), {n(acum.cidadesCriadas)} cidade(s) criada(s)
              {acum.rejeitadas.length > 0 && <>, {n(acum.rejeitadas.length)} rejeitada(s) no servidor</>}.
              {Object.keys(acum.porCodigo).length > 0 && (
                <ul style={{ margin: "4px 0 0" }}>
                  {Object.entries(acum.porCodigo).sort((a, b) => Number(a[0]) - Number(b[0])).map(([cod, q]) => (
                    <li key={cod}>Prioridade <b>{CODIGOS[Number(cod)] ?? `código ${cod}`}</b>: {n(q)} OS</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
