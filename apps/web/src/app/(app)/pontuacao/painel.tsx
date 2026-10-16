"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ConteudoPontuacao, EstadoPontuacao, ModoPublicacao, RespostaPublicar, RespostaValidar, VersaoResumo } from "@farol/shared";
import { ApiError, apiPost, apiPut } from "@/lib/api";
import { dataHora } from "@/lib/format";
import { ErroAcao } from "@/components/ui";
import { Editor } from "./editor";
import { Versoes } from "./versoes";

interface Props {
  estado: EstadoPontuacao;
  escopo: string;
  escopoNome: string;
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

const MODO_TXT: Record<ModoPublicacao, string> = { novas: "somente novas OS", reclassificar: "reclassificar as OS abertas" };

const ehConflito = (e: unknown) => e instanceof ApiError && e.status === 409 && e.detalhe.regra === "conflito_rascunho";

export function Painel({ estado, escopo, escopoNome, podeEditar, podeAprovar, atorId, aviso, onAtualizado, onRecarregar, onSujo }: Props) {
  const inicial: ConteudoPontuacao | null = estado.rascunho?.conteudo ?? estado.publicada?.conteudo ?? estado.herdada?.conteudo ?? null;
  const [conteudo, setConteudo] = useState<ConteudoPontuacao | null>(inicial);
  const [validacao, setValidacao] = useState<{ erros: string[]; alertas: string[] } | null>(null);
  const [conflito, setConflito] = useState<string | null>(null);
  const [just, setJust] = useState("");
  const [vigencia, setVigencia] = useState("");
  const [modo, setModo] = useState<"" | ModoPublicacao>(""); // sem valor padrão: a escolha é explícita (§5)
  const [faltou, setFaltou] = useState(false);

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
      : `Publicada a v${r.resultado.numero} (${MODO_TXT[modo as ModoPublicacao]}). O histórico anterior das OS foi mantido.`),
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
    if (!just.trim() || !vigencia || Number.isNaN(Date.parse(vigencia)) || !modo) { setFaltou(true); return; }
    setFaltou(false);
    publicar.mutate();
  }

  const r = estado.rascunho;
  const bloqueioPublicar = !r ? "Salve um rascunho para publicar." : sujo ? "Salve o rascunho antes de publicar: a publicação usa o rascunho salvo." : null;

  return (
    <>
      <h2>Pontuação — {escopoNome}</h2>
      <p className="mu">
        Versão publicada nunca é editada: edite o rascunho e publique uma nova versão. Valores demonstrativos.
        {estado.exigirAprovacao && <> Neste ambiente a publicação exige aprovação de um segundo usuário.</>}
      </p>

      <p>
        {estado.publicada ? (
          <>Vigente: <b>v{estado.publicada.numero}</b> {estado.publicada.vigenciaInicio && <span className="mu">desde {dataHora(estado.publicada.vigenciaInicio)}</span>}</>
        ) : estado.herdada ? (
          <>Sem versão própria: vale a <b>global v{estado.herdada.numero}</b>. A versão da cidade prevalece sobre a global assim que publicada.</>
        ) : (
          <span className="mu">Nenhuma versão publicada neste escopo.</span>
        )}
        {r && <> · Rascunho: <b>v{r.numero}</b>{r.restauradaDe != null && <> (de v{r.restauradaDe})</>} <span className="mu">alterado{r.atualizadoPor ? ` por ${r.atualizadoPor}` : ""} em {dataHora(r.atualizadoEm)}</span></>}
      </p>

      {aviso && <div className="okm" role="status">{aviso}</div>}
      {estado.aguardando && (
        <div className="warn">
          A <b>v{estado.aguardando.numero}</b> está aguardando aprovação{estado.aguardando.autor ? ` (enviada por ${estado.aguardando.autor})` : ""}.
          Enquanto isso não for decidido, nenhuma outra versão pode ser publicada neste escopo.
        </div>
      )}
      {conflito && (
        <div className="warn" role="alert">
          <b>Outro usuário alterou o rascunho.</b> {conflito} Suas alterações <b>não</b> foram salvas.{" "}
          <button onClick={onRecarregar}>Recarregar o rascunho</button> <span className="mu">(descarta o que você editou aqui)</span>
        </div>
      )}

      {!conteudo ? (
        <div className="warn">Não há versão publicada nem rascunho para partir. Publique primeiro a versão global.</div>
      ) : (
        <>
          <Editor conteudo={conteudo} onEditar={editar} somenteLeitura={!podeEditar} />

          {podeEditar && (
            <p>
              <button className="btn-pr" onClick={() => salvar.mutate()} disabled={ocupado || !sujo}>Salvar rascunho</button>{" "}
              <button onClick={() => validar.mutate()} disabled={ocupado}>Validar</button>{" "}
              {sujo && <button onClick={() => { if (window.confirm("Descartar as alterações ainda não salvas?")) onRecarregar(); }} disabled={ocupado}>Desfazer alterações</button>}{" "}
              {r && <button onClick={() => { if (window.confirm(`Descartar o rascunho v${r.numero}?`)) descartar.mutate(); }} disabled={ocupado}>Descartar rascunho</button>}
              {sujo && <span className="mu"> · alterações não salvas</span>}
            </p>
          )}

          {validacao && (
            <div aria-live="polite">
              {validacao.erros.length === 0 && <div className="okm">Sem erros: a versão pode ser publicada{validacao.alertas.length ? ", com alertas" : ""}.</div>}
              {validacao.erros.map((e) => <div key={e} className="err"><b>Erro:</b> {e}</div>)}
              {validacao.alertas.map((a) => <div key={a} className="warn">Alerta: {a}</div>)}
            </div>
          )}
        </>
      )}

      {erroAcao && <ErroAcao erro={erroAcao} />}

      {podeEditar && conteudo && (
        <>
          <h3>Publicar</h3>
          <div className="box">
            <div className="row">
              <label className="min-w-[280px] max-w-[520px] flex-1">
                Justificativa (obrigatória)
                <textarea rows={2} className="w-full" value={just} onChange={(e) => { setJust(e.target.value); setFaltou(false); }} />
              </label>
              <label>
                Início de vigência
                <input type="datetime-local" value={vigencia} onChange={(e) => { setVigencia(e.target.value); setFaltou(false); }} />
              </label>
              <label>
                Modo (escolha obrigatória)
                <select value={modo} onChange={(e) => { setModo(e.target.value as "" | ModoPublicacao); setFaltou(false); }} aria-invalid={faltou && !modo}>
                  <option value="">Escolha…</option>
                  <option value="novas">Somente novas OS</option>
                  <option value="reclassificar">Reclassificar as OS abertas</option>
                </select>
              </label>
            </div>
            {modo === "novas" && <p className="mu">As OS que já existem continuam na versão em que foram calculadas.</p>}
            {modo === "reclassificar" && <p className="mu">Quando a vigência chegar, as OS abertas serão recalculadas com esta versão; o resultado anterior permanece no histórico.</p>}
            {faltou && <div className="err" role="alert">Informe a justificativa e o início da vigência e escolha o modo (somente novas OS ou reclassificar as abertas).</div>}
            {bloqueioPublicar && <p className="mu">{bloqueioPublicar}</p>}
            <p>
              <button className="btn-pr" onClick={aoPublicar} disabled={ocupado || !!bloqueioPublicar || !!estado.aguardando}>
                {estado.exigirAprovacao ? "Enviar para aprovação" : "Publicar nova versão"}
              </button>
            </p>
          </div>
        </>
      )}

      <h3>Versões</h3>
      <Versoes
        estado={estado} podeEditar={podeEditar} podeAprovar={podeAprovar} atorId={atorId} ocupado={ocupado}
        onRestaurar={(v) => { if (!sujo || window.confirm("Há alterações não salvas, que serão perdidas ao restaurar. Continuar?")) restaurar.mutate(v); }}
        onAprovar={(v) => aprovar.mutate(v)}
      />
    </>
  );
}
