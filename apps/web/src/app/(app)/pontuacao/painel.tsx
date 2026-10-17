"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import FactCheckOutlined from "@mui/icons-material/FactCheckOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutlineOutlined";
import Publish from "@mui/icons-material/Publish";
import Refresh from "@mui/icons-material/Refresh";
import SaveOutlined from "@mui/icons-material/SaveOutlined";
import Undo from "@mui/icons-material/Undo";
import type { ConteudoPontuacao, EstadoPontuacao, ModoPublicacao, RespostaPublicar, RespostaValidar, VersaoResumo } from "@farol/shared";
import { ApiError, apiPost, apiPut } from "@/lib/api";
import { MODO_PUBLICACAO } from "@/lib/escopo";
import { dataHora } from "@/lib/format";
import { Alerta, ErroAcao } from "@/components/alerta";
import { CampoFormulario } from "@/components/campo";
import { Icone } from "@/components/icone";
import { Editor } from "./editor";
import { Versoes } from "./versoes";

interface Props {
  estado: EstadoPontuacao;
  escopo: string;
  podeEditar: boolean;
  podeAprovar: boolean;
  atorId: string;
  aviso: string | null;
  /** Estado novo do servidor (depois de salvar, publicar…): a tela recomeça a partir dele. */
  onAtualizado: (estado: EstadoPontuacao, aviso: string) => void;
  /** Recarrega o escopo do servidor, descartando o que foi editado aqui. */
  onRecarregar: () => void;
  onSujo: (sujo: boolean) => void;
}

const ehConflito = (e: unknown) => e instanceof ApiError && e.status === 409 && e.detalhe.regra === "conflito_rascunho";

/** Campos do formulário de publicação, para levar a mensagem de "faltou" ao campo certo. */
interface Faltas { just?: string; vigencia?: string; modo?: string }

export function Painel({ estado, escopo, podeEditar, podeAprovar, atorId, aviso, onAtualizado, onRecarregar, onSujo }: Props) {
  const inicial: ConteudoPontuacao | null = estado.rascunho?.conteudo ?? estado.publicada?.conteudo ?? estado.herdada?.conteudo ?? null;
  const [conteudo, setConteudo] = useState<ConteudoPontuacao | null>(inicial);
  const [validacao, setValidacao] = useState<{ erros: string[]; alertas: string[] } | null>(null);
  const [conflito, setConflito] = useState<string | null>(null);
  const [just, setJust] = useState("");
  const [vigencia, setVigencia] = useState("");
  const [modo, setModo] = useState<"" | ModoPublicacao>(""); // sem valor padrão: a escolha é explícita (§5)
  const [faltas, setFaltas] = useState<Faltas>({});

  // o que está no servidor: o rascunho, ou (sem rascunho) a base de onde se parte
  const sujo = JSON.stringify(conteudo) !== JSON.stringify(inicial);
  useEffect(() => { onSujo(sujo); }, [sujo, onSujo]);

  const editar = (alterar: (c: ConteudoPontuacao) => void) => {
    if (!conteudo) return;
    const novo = structuredClone(conteudo);
    alterar(novo);
    setConteudo(novo);
    setValidacao(null);
  };

  const qs = `?escopo=${encodeURIComponent(escopo)}`;
  const aoFalhar = (e: unknown) => { if (ehConflito(e)) setConflito((e as Error).message); };

  const salvar = useMutation({
    mutationFn: () => apiPut<EstadoPontuacao>(`/pontuacao/rascunho${qs}`, { conteudo, etag: estado.rascunho?.etag ?? null }),
    onSuccess: (e) => onAtualizado(e, `Rascunho salvo (v${e.rascunho?.numero}).`),
    onError: aoFalhar,
  });
  const validar = useMutation({
    mutationFn: () => apiPost<RespostaValidar>(`/pontuacao/validar${qs}`, { conteudo }),
    onSuccess: (r) => setValidacao({ erros: r.erros, alertas: r.alertas }),
  });
  const publicar = useMutation({
    mutationFn: () => apiPost<RespostaPublicar>("/pontuacao/publicar", {
      rascunhoId: estado.rascunho!.id, etag: estado.rascunho!.etag, justificativa: just.trim(),
      vigenciaInicio: new Date(vigencia).toISOString(), modo,
    }),
    onSuccess: (r) => onAtualizado(r, r.resultado.aguardandoAprovacao
      ? `Versão v${r.resultado.numero} enviada para aprovação. Ela só vale depois que outra pessoa aprovar.`
      : `Publicada a v${r.resultado.numero} (${MODO_PUBLICACAO[modo as ModoPublicacao].toLowerCase()}). O histórico anterior das OS foi mantido.`),
    onError: (e) => {
      aoFalhar(e);
      if (e instanceof ApiError && e.detalhe.erros) setValidacao({ erros: e.detalhe.erros, alertas: e.detalhe.alertas ?? [] });
    },
  });
  const restaurar = useMutation({
    mutationFn: (v: VersaoResumo) => apiPost<EstadoPontuacao>("/pontuacao/restaurar", { versaoId: v.id }),
    onSuccess: (e, v) => onAtualizado(e, `Versão v${v.numero} restaurada como novo rascunho (v${e.rascunho?.numero}). A publicada não foi alterada.`),
    onError: aoFalhar,
  });
  const aprovar = useMutation({
    mutationFn: (v: VersaoResumo) => apiPost<EstadoPontuacao>("/pontuacao/aprovar", { versaoId: v.id }),
    onSuccess: (e, v) => onAtualizado(e, `Versão v${v.numero} aprovada e publicada.`),
  });
  const descartar = useMutation({
    mutationFn: () => apiPost<EstadoPontuacao>("/pontuacao/descartar", { rascunhoId: estado.rascunho!.id, etag: estado.rascunho!.etag }),
    onSuccess: (e) => onAtualizado(e, "Rascunho descartado."),
    onError: aoFalhar,
  });

  const ocupado = [salvar, validar, publicar, restaurar, aprovar, descartar].some((m) => m.isPending);
  const erroAcao = [salvar, publicar, restaurar, aprovar, descartar, validar].map((m) => m.error).find((e) => e && !ehConflito(e));

  function aoPublicar() {
    const f: Faltas = {
      just: just.trim() ? undefined : "Informe a justificativa.",
      vigencia: vigencia && !Number.isNaN(Date.parse(vigencia)) ? undefined : "Informe o início da vigência.",
      modo: modo ? undefined : "Escolha o modo: somente novas OS ou reclassificar as abertas.",
    };
    if (f.just || f.vigencia || f.modo) { setFaltas(f); return; }
    setFaltas({});
    publicar.mutate();
  }

  const r = estado.rascunho;
  const bloqueioPublicar = !r ? "Salve um rascunho para publicar." : sujo ? "Salve o rascunho antes de publicar: a publicação usa o rascunho salvo." : null;

  return (
    <>
      <div className="card">
        <dl className="summary">
          <div className="summary__item">
            <dt className="summary__label">Vigente</dt>
            <dd className="summary__value">
              {estado.publicada ? (
                <>v{estado.publicada.numero}{estado.publicada.vigenciaInicio && <span className="font-normal text-muted">desde {dataHora(estado.publicada.vigenciaInicio)}</span>}</>
              ) : estado.herdada ? (
                <>global v{estado.herdada.numero}</>
              ) : (
                <span className="font-normal text-muted">nenhuma neste escopo</span>
              )}
            </dd>
          </div>
          {r && (
            <div className="summary__item">
              <dt className="summary__label">Rascunho</dt>
              <dd className="summary__value">
                v{r.numero}{r.restauradaDe != null && <> (de v{r.restauradaDe})</>}
                <span className="font-normal text-muted">alterado{r.atualizadoPor ? ` por ${r.atualizadoPor}` : ""} em {dataHora(r.atualizadoEm)}</span>
              </dd>
            </div>
          )}
        </dl>
        {!estado.publicada && estado.herdada && (
          <p className="text-muted">Sem versão própria: vale a global v{estado.herdada.numero}. A versão da cidade prevalece sobre a global assim que publicada.</p>
        )}
        {estado.exigirAprovacao && <p className="text-muted">Neste ambiente a publicação exige aprovação de um segundo usuário.</p>}
      </div>

      {aviso && <Alerta tipo="success" role="status">{aviso}</Alerta>}
      {estado.aguardando && (
        <Alerta tipo="warning" titulo={`A v${estado.aguardando.numero} está aguardando aprovação${estado.aguardando.autor ? ` (enviada por ${estado.aguardando.autor})` : ""}.`}>
          Enquanto isso não for decidido, nenhuma outra versão pode ser publicada neste escopo.
        </Alerta>
      )}
      {conflito && (
        <Alerta
          tipo="warning" role="alert" titulo="Outro usuário alterou o rascunho."
          acoes={<>
            <button type="button" className="button button--sm" onClick={onRecarregar}><Icone de={Refresh} />Recarregar o rascunho</button>
            <span className="button-group__note">(descarta o que você editou aqui)</span>
          </>}
        >
          {conflito} Suas alterações <b>não</b> foram salvas.
        </Alerta>
      )}

      {!conteudo ? (
        <Alerta tipo="warning">Não há versão publicada nem rascunho para partir. Publique primeiro a versão global.</Alerta>
      ) : (
        <section className="page__section" aria-labelledby="pont-criterios">
          <h2 id="pont-criterios" className="page__section-title">Critérios e faixas</h2>
          <Editor conteudo={conteudo} onEditar={editar} somenteLeitura={!podeEditar} />

          {podeEditar && (
            <div className="button-group">
              <button type="button" className="button button--primary" onClick={() => salvar.mutate()} disabled={ocupado || !sujo}><Icone de={SaveOutlined} />Salvar rascunho</button>
              <button type="button" className="button" onClick={() => validar.mutate()} disabled={ocupado}><Icone de={FactCheckOutlined} />Validar</button>
              {sujo && (
                <button type="button" className="button" onClick={() => { if (window.confirm("Descartar as alterações ainda não salvas?")) onRecarregar(); }} disabled={ocupado}>
                  <Icone de={Undo} />Desfazer alterações
                </button>
              )}
              {r && (
                <button type="button" className="button button--danger" onClick={() => { if (window.confirm(`Descartar o rascunho v${r.numero}?`)) descartar.mutate(); }} disabled={ocupado}>
                  <Icone de={DeleteOutline} />Descartar rascunho
                </button>
              )}
              {sujo && <span className="button-group__note">Alterações não salvas</span>}
            </div>
          )}

          {validacao && (
            <div className="flex flex-col gap-2" aria-live="polite">
              {validacao.erros.length === 0 && <Alerta tipo="success">Sem erros: a versão pode ser publicada{validacao.alertas.length ? ", com alertas" : ""}.</Alerta>}
              {validacao.erros.map((e) => <Alerta key={e} tipo="error" titulo="Erro">{e}</Alerta>)}
              {validacao.alertas.map((a) => <Alerta key={a} tipo="warning" titulo="Alerta">{a}</Alerta>)}
            </div>
          )}
        </section>
      )}

      {erroAcao && <ErroAcao erro={erroAcao} />}

      {podeEditar && conteudo && (
        <section className="page__section" aria-labelledby="pont-publicar">
          <h2 id="pont-publicar" className="page__section-title">Publicar</h2>
          <div className="card">
            <div className="form-grid">
              <CampoFormulario id="pub-just" rotulo="Justificativa" obrigatorio erro={faltas.just} className="form-grid__wide">
                {(a) => <textarea {...a} className="control" rows={2} value={just} onChange={(e) => { setJust(e.target.value); setFaltas({}); }} />}
              </CampoFormulario>
              <CampoFormulario id="pub-vig" rotulo="Início de vigência" obrigatorio erro={faltas.vigencia}>
                {(a) => <input {...a} className="control" type="datetime-local" value={vigencia} onChange={(e) => { setVigencia(e.target.value); setFaltas({}); }} />}
              </CampoFormulario>
              <CampoFormulario
                id="pub-modo" rotulo="Modo" obrigatorio erro={faltas.modo}
                dica={modo === "novas" ? "As OS que já existem continuam na versão em que foram calculadas."
                  : modo === "reclassificar" ? "Quando a vigência chegar, as OS abertas serão recalculadas com esta versão; o resultado anterior permanece no histórico."
                  : "Escolha explícita: não há valor padrão."}
              >
                {(a) => (
                  <select {...a} className="control" value={modo} onChange={(e) => { setModo(e.target.value as "" | ModoPublicacao); setFaltas({}); }}>
                    <option value="">Escolha…</option>
                    <option value="novas">{MODO_PUBLICACAO.novas}</option>
                    <option value="reclassificar">{MODO_PUBLICACAO.reclassificar}</option>
                  </select>
                )}
              </CampoFormulario>
            </div>
            <div className="card__footer">
              <button
                type="button" className="button button--primary" onClick={aoPublicar}
                disabled={ocupado || !!bloqueioPublicar || !!estado.aguardando} aria-describedby={bloqueioPublicar ? "pub-bloqueio" : undefined}
              >
                <Icone de={Publish} />{estado.exigirAprovacao ? "Enviar para aprovação" : "Publicar nova versão"}
              </button>
              {bloqueioPublicar && <span id="pub-bloqueio" className="button-group__note">{bloqueioPublicar}</span>}
            </div>
          </div>
        </section>
      )}

      <section className="page__section" aria-labelledby="pont-versoes">
        <h2 id="pont-versoes" className="page__section-title">Versões</h2>
        <Versoes
          estado={estado} podeEditar={podeEditar} podeAprovar={podeAprovar} atorId={atorId} ocupado={ocupado}
          onRestaurar={(v) => { if (!sujo || window.confirm("Há alterações não salvas, que serão perdidas ao restaurar. Continuar?")) restaurar.mutate(v); }}
          onAprovar={(v) => aprovar.mutate(v)}
        />
      </section>
    </>
  );
}
