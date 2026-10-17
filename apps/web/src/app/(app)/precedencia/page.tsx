"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import CheckCircleOutline from "@mui/icons-material/CheckCircleOutlineOutlined";
import Refresh from "@mui/icons-material/Refresh";
import Undo from "@mui/icons-material/Undo";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import { textoCondicoes, type Regra, type RespostaPrever, type RespostaRegras, type RespostaSalvarRegras } from "@farol/shared";
import { api, ApiError, apiPost, apiPut } from "@/lib/api";
import { dataHora } from "@/lib/format";
import { Alerta, ErroAcao } from "@/components/alerta";
import { CabecalhoPagina } from "@/components/cabecalho-pagina";
import { EstadoConsulta, EstadoVazio } from "@/components/estados";
import { Icone } from "@/components/icone";
import { JustificativaDialog } from "@/components/justificativa-dialog";
import { Pill } from "@/components/prioridade";
import { Tabela } from "@/components/tabela";
import { EditorRegras } from "./editor";
import { Impacto } from "./impacto";

const paraRegra = (r: RespostaRegras["regras"][number]): Regra => ({
  id: r.id, nome: r.nome, ativa: r.ativa, nivel: r.nivel, prioridadeMinima: r.prioridadeMinima,
  cond: r.condicoes.map((c) => ({ criterio: c.criterio, opcoes: [...c.opcoes] })),
});

/** Prévia vale só para o rascunho exato que foi pré-visualizado: qualquer edição depois a invalida. */
interface Previa extends RespostaPrever { chave: string }

export default function PrecedenciaPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["regras"], queryFn: () => api<RespostaRegras>("/regras") });
  const dados = q.data;

  const original = useMemo(() => (dados ? dados.regras.map(paraRegra) : []), [dados]);
  const [rascunho, setRascunho] = useState<Regra[] | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [dialogo, setDialogo] = useState(false);
  const [gravada, setGravada] = useState<{ numero: number; alertas: string[] } | null>(null);

  // Chegou outra versão do servidor (gravação própria ou recarga): o rascunho local deixa de valer.
  useEffect(() => { setRascunho(null); setPrevia(null); }, [dados?.versao]);

  const regras = rascunho ?? original;
  const chave = JSON.stringify(regras);
  const alterado = rascunho !== null && chave !== JSON.stringify(original);
  const pv = previa !== null && previa.chave === chave ? previa : null; // prévia do rascunho ATUAL (null se já foi editado depois)
  const podeConfirmar = alterado && pv !== null && pv.erros.length === 0;

  const editar = (novas: Regra[]) => { setRascunho(novas); setGravada(null); };

  const prever = useMutation({
    mutationFn: () => apiPost<RespostaPrever>("/regras/prever", { regras }),
    onSuccess: (r) => setPrevia({ ...r, chave }),
  });

  const salvar = useMutation({
    mutationFn: (justificativa: string) => apiPut<RespostaSalvarRegras>("/regras", { regras, versaoBase: dados!.versao, justificativa }),
    onSuccess: (r) => {
      qc.setQueryData<RespostaRegras>(["regras"], r);
      setGravada({ numero: r.versao, alertas: r.alertas });
      for (const k of ["fila", "mapa", "os"]) qc.invalidateQueries({ queryKey: [k] });
    },
  });

  function descartar() {
    setRascunho(null); setPrevia(null); setGravada(null); prever.reset(); salvar.reset();
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Regras de precedência (camada A)"
        descricao={<>
          Cada regra é um E lógico de condições e define um nível de precedência (1–10) e uma prioridade mínima. Vale para todas as cidades. Valores demonstrativos.
          {dados && <> Versão em vigor: <b className="font-mono">v{dados.versao}</b>.</>}
        </>}
      />
      <EstadoConsulta consulta={q} carregando="Carregando as regras…" erro="Não foi possível carregar as regras de precedência.">
        {(d) => (
          <>
            {gravada && (
              <Alerta tipo="success" role="status" titulo={`Versão v${gravada.numero} gravada.`}>
                As OS abertas estão sendo reclassificadas: a fila reflete a mudança em até 1 minuto.
                {gravada.alertas.map((a) => <div key={a} className="text-muted">Alerta: {a}</div>)}
              </Alerta>
            )}

            {!d.editavel ? (
              <section className="page__section" aria-labelledby="prec-regras">
                <h2 id="prec-regras" className="page__section-title">Regras em vigor</h2>
                <p className="text-muted">Somente o Administrador altera as regras. Cada alteração exige justificativa e gera uma nova versão.</p>
                <TabelaLeitura regras={d.regras} />
              </section>
            ) : (
              <section className="page__section" aria-labelledby="prec-editar">
                <h2 id="prec-editar" className="page__section-title">Editar regras</h2>
                {d.criterios.length === 0 && (
                  <Alerta tipo="warning" role="alert">Não há versão de pontuação global vigente: sem ela não dá para validar condições, então a edição está desligada.</Alerta>
                )}
                <p className="text-muted">
                  Edite, pré-visualize o impacto nas OS abertas e só então confirme com a justificativa. Nada é gravado antes disso, e a versão
                  anterior nunca é alterada. A nova versão <b>reclassifica as OS abertas</b>.
                </p>

                <EditorRegras regras={regras} criterios={d.criterios} onChange={editar} desabilitado={d.criterios.length === 0 || salvar.isPending} />

                <div className="button-group">
                  <button type="button" className="button" disabled={!alterado || prever.isPending || salvar.isPending} onClick={() => prever.mutate()}>
                    <Icone de={VisibilityOutlined} />{prever.isPending ? "Calculando o impacto…" : "Pré-visualizar"}
                  </button>
                  <button
                    type="button" className="button button--primary" disabled={!podeConfirmar || salvar.isPending}
                    aria-describedby="prec-estado" onClick={() => setDialogo(true)}
                  >
                    <Icone de={CheckCircleOutline} />{salvar.isPending ? "Gravando…" : `Confirmar (gera a v${d.versao + 1})`}
                  </button>
                  <button type="button" className="button" disabled={!alterado || salvar.isPending} onClick={descartar}>
                    <Icone de={Undo} />Desfazer alterações
                  </button>
                  <span id="prec-estado" className="button-group__note">
                    {!alterado ? "Nenhuma alteração." : !pv ? "Pré-visualize o rascunho atual antes de confirmar." : null}
                  </span>
                </div>

                {prever.isError && <ErroAcao erro={prever.error} />}
                {pv && pv.erros.length > 0 && (
                  <Alerta tipo="error" role="alert" titulo="Corrija antes de continuar">
                    <ul className="list-disc pl-5">{pv.erros.map((e) => <li key={e}>{e}</li>)}</ul>
                  </Alerta>
                )}
                {pv && pv.alertas.map((a) => <Alerta key={a} tipo="warning" role="status" titulo="Alerta">{a}</Alerta>)}
                {pv?.impacto && <Impacto impacto={pv.impacto} />}

                {salvar.isError && (
                  <>
                    <ErroAcao erro={salvar.error} />
                    {salvar.error instanceof ApiError && salvar.error.detalhe.erros?.map((e) => <Alerta key={e} tipo="error">{e}</Alerta>)}
                    {salvar.error instanceof ApiError && salvar.error.status === 409 && (
                      <div className="button-group">
                        <button type="button" className="button" onClick={() => { descartar(); q.refetch(); }}>
                          <Icone de={Refresh} />Recarregar as regras (descarta o rascunho)
                        </button>
                      </div>
                    )}
                  </>
                )}

                <JustificativaDialog
                  aberto={dialogo}
                  titulo={`Justificativa da alteração das regras de precedência (gera a v${d.versao + 1} e reclassifica as OS abertas)`}
                  onConfirmar={(j) => { setDialogo(false); salvar.mutate(j); }}
                  onCancelar={() => setDialogo(false)}
                />
              </section>
            )}

            <section className="page__section" aria-labelledby="prec-versoes">
              <h2 id="prec-versoes" className="page__section-title">Versões</h2>
              <Tabela legenda="Versões das regras de precedência">
                <thead><tr><th scope="col">Versão</th><th scope="col">Gravada em</th><th scope="col">Por</th><th scope="col">Regras</th><th scope="col">Justificativa</th></tr></thead>
                <tbody>
                  {d.versoes.map((v) => (
                    <tr key={v.numero} className="data-table__row--interactive">
                      <td className="data-table__cell--num">v{v.numero}{v.vigente && <span className="text-muted"> (em vigor)</span>}</td>
                      <td className="data-table__cell--num">{dataHora(v.criadoEm)}</td>
                      <td>{v.autor ?? "—"}</td>
                      <td className="data-table__cell--num">{v.quantidade}</td>
                      <td className="data-table__cell--wrap">{v.justificativa}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            </section>
          </>
        )}
      </EstadoConsulta>
    </>
  );
}

/** Quem não é Administrador vê as regras como antes: só leitura. */
function TabelaLeitura({ regras }: { regras: RespostaRegras["regras"] }) {
  if (regras.length === 0) return <EstadoVazio>Nenhuma regra cadastrada.</EstadoVazio>;
  return (
    <Tabela legenda="Regras de precedência (somente leitura)">
      <thead>
        <tr>
          <th scope="col">Ativa</th><th scope="col">Regra</th><th scope="col">Condição</th><th scope="col">Nível</th>
          <th scope="col">Prioridade mínima</th><th scope="col">Versão</th>
        </tr>
      </thead>
      <tbody>
        {regras.map((r) => (
          <tr key={r.id} className="data-table__row--interactive">
            <td>{r.ativa ? "Sim" : "Não"}</td>
            <td><b>{r.nome}</b> <span className="font-mono text-muted">{r.id}</span></td>
            <td className="data-table__cell--wrap">{textoCondicoes(r.condicoes)}</td>
            <td className="data-table__cell--num">{r.nivel}</td>
            <td><Pill codigo={r.prioridadeMinima} /></td>
            <td className="data-table__cell--num">v{r.versao} <span className="text-muted">· {dataHora(r.atualizadoEm)}</span></td>
          </tr>
        ))}
      </tbody>
    </Tabela>
  );
}
