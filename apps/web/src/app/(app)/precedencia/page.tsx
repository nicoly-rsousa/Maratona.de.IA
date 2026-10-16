"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { textoCondicoes, type Regra, type RespostaPrever, type RespostaRegras, type RespostaSalvarRegras } from "@farol/shared";
import { api, ApiError, apiPost, apiPut } from "@/lib/api";
import { dataHora } from "@/lib/format";
import { Carregando, ErroAcao, ErroApi, Pill } from "@/components/ui";
import { JustificativaDialog } from "@/components/justificativa-dialog";
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

  if (q.isPending) return <><h2>Regras de precedência (camada A)</h2><Carregando texto="Carregando as regras…" /></>;
  if (q.isError) return <><h2>Regras de precedência (camada A)</h2><ErroApi erro={q.error} titulo="Não foi possível carregar as regras de precedência." onRetry={() => q.refetch()} /></>;
  const d = q.data;

  return (
    <>
      <h2>Regras de precedência (camada A)</h2>
      <p className="mu">
        Cada regra é um E lógico de condições e define um nível de precedência (1–10) e uma prioridade mínima. Valores demonstrativos.
        Vale para todas as cidades. Versão em vigor: <b className="m">v{d.versao}</b>.
      </p>

      {gravada && (
        <div className="okm" role="status">
          Versão <b className="m">v{gravada.numero}</b> gravada. As OS abertas estão sendo reclassificadas: a fila reflete a mudança em até 1 minuto.
          {gravada.alertas.map((a) => <div key={a} className="mu">Alerta: {a}</div>)}
        </div>
      )}

      {!d.editavel ? (
        <>
          <p className="mu">Somente o Administrador altera as regras. Cada alteração exige justificativa e gera uma nova versão.</p>
          <TabelaLeitura regras={d.regras} />
        </>
      ) : (
        <>
          {d.criterios.length === 0 && (
            <div className="warn" role="alert">Não há versão de pontuação global vigente: sem ela não dá para validar condições, então a edição está desligada.</div>
          )}
          <p className="mu">
            Edite, pré-visualize o impacto nas OS abertas e só então confirme com a justificativa. Nada é gravado antes disso, e a versão
            anterior nunca é alterada. A nova versão <b>reclassifica as OS abertas</b>.
          </p>

          <EditorRegras regras={regras} criterios={d.criterios} onChange={editar} desabilitado={d.criterios.length === 0 || salvar.isPending} />

          <p>
            <button type="button" disabled={!alterado || prever.isPending || salvar.isPending} onClick={() => prever.mutate()}>
              {prever.isPending ? "Calculando o impacto…" : "Pré-visualizar"}
            </button>{" "}
            <button type="button" className="pr" disabled={!podeConfirmar || salvar.isPending} onClick={() => setDialogo(true)}>
              {salvar.isPending ? "Gravando…" : `Confirmar (gera a v${d.versao + 1})`}
            </button>{" "}
            <button type="button" disabled={!alterado || salvar.isPending} onClick={descartar}>Desfazer alterações</button>
            {!alterado && <span className="mu"> Nenhuma alteração.</span>}
            {alterado && !pv && <span className="mu"> Pré-visualize o rascunho atual antes de confirmar.</span>}
          </p>

          {prever.isError && <ErroAcao erro={prever.error} />}
          {pv && pv.erros.length > 0 && (
            <div className="err" role="alert"><b>Corrija antes de continuar:</b>{pv.erros.map((e) => <div key={e}>{e}</div>)}</div>
          )}
          {pv && pv.alertas.map((a) => <div key={a} className="warn" role="status"><b>Alerta:</b> {a}</div>)}
          {pv?.impacto && <Impacto impacto={pv.impacto} />}

          {salvar.isError && (
            <>
              <ErroAcao erro={salvar.error} />
              {salvar.error instanceof ApiError && salvar.error.detalhe.erros?.map((e) => <div key={e} className="err">{e}</div>)}
              {salvar.error instanceof ApiError && salvar.error.status === 409 && (
                <p><button type="button" onClick={() => { descartar(); q.refetch(); }}>Recarregar as regras (descarta o rascunho)</button></p>
              )}
            </>
          )}

          <JustificativaDialog
            aberto={dialogo}
            titulo={`Justificativa da alteração das regras de precedência (gera a v${d.versao + 1} e reclassifica as OS abertas)`}
            onConfirmar={(j) => { setDialogo(false); salvar.mutate(j); }}
            onCancelar={() => setDialogo(false)}
          />
        </>
      )}

      <h3>Versões</h3>
      <div className="tw">
        <table className="tabela">
          <thead><tr><th>Versão</th><th>Gravada em</th><th>Por</th><th>Regras</th><th>Justificativa</th></tr></thead>
          <tbody>
            {d.versoes.map((v) => (
              <tr key={v.numero} className="r">
                <td className="m">v{v.numero}{v.vigente && <span className="mu"> (em vigor)</span>}</td>
                <td className="m">{dataHora(v.criadoEm)}</td>
                <td>{v.autor ?? "—"}</td>
                <td className="m">{v.quantidade}</td>
                <td className="max-w-[420px] whitespace-normal">{v.justificativa}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Quem não é Administrador vê as regras como antes: só leitura. */
function TabelaLeitura({ regras }: { regras: RespostaRegras["regras"] }) {
  if (regras.length === 0) return <p className="mu">Nenhuma regra cadastrada.</p>;
  return (
    <div className="tw">
      <table className="tabela">
        <thead>
          <tr><th>Ativa</th><th>Regra</th><th>Condição</th><th>Nível</th><th>Prioridade mínima</th><th>Versão</th></tr>
        </thead>
        <tbody>
          {regras.map((r) => (
            <tr key={r.id} className="r">
              <td><input type="checkbox" checked={r.ativa} disabled aria-label={`${r.nome}: ${r.ativa ? "ativa" : "inativa"} (somente leitura)`} /></td>
              <td><b>{r.nome}</b> <span className="mu m">{r.id}</span></td>
              <td className="whitespace-normal">{textoCondicoes(r.condicoes)}</td>
              <td className="m">{r.nivel}</td>
              <td><Pill codigo={r.prioridadeMinima} /></td>
              <td className="m" title={`atualizada em ${dataHora(r.atualizadoEm)}`}>v{r.versao}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
