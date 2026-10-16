"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PASSOS_DESPACHO, proximoPasso, urlMapas,
  type DetalheOS, type PassoDespacho, type PontoMapa, type Recomendacao,
} from "@farol/shared";
import { api, apiPost } from "@/lib/api";
import type { Ator } from "@/lib/types";
import { Carregando, ErroAcao, ErroApi } from "@/components/ui";
import { JustificativaDialog } from "@/components/justificativa-dialog";

const ponto = (lat: number | null, lng: number | null): PontoMapa | null => (lat != null && lng != null ? { lat, lng } : null);
const metros = (m: number | null) => (m == null ? "—" : `${m.toLocaleString("pt-BR")} m`);

export function DespachoAba({ d, ator }: { d: DetalheOS; ator: Ator }) {
  const qc = useQueryClient();
  const o = d.os;
  const desp = d.despacho;
  const podeDesignar = ator.permissoes.includes("designar");
  const podeExcecao = ator.permissoes.includes("excecao");

  const [apoio, setApoio] = useState(false);
  const [alvo, setAlvo] = useState<Recomendacao | null>(null);
  const [removendo, setRemovendo] = useState(false);
  const [bloqueio, setBloqueio] = useState<string | null>(null);

  const osPonto = ponto(o.lat, o.lng);
  const destino = osPonto ?? o.endereco;
  const aproximada = osPonto == null;

  const recomendadas = useQuery({
    queryKey: ["equipes", o.id, apoio],
    queryFn: () => api<Recomendacao[]>(`/os/${o.id}/equipes${apoio ? "?apoio=1" : ""}`),
    enabled: podeDesignar && !desp && o.status === "Aguardando despacho",
    staleTime: 0,
  });

  const depois = () => {
    qc.invalidateQueries({ queryKey: ["os", o.id] });
    qc.invalidateQueries({ queryKey: ["equipes", o.id] });
    qc.invalidateQueries({ queryKey: ["fila"] });
  };
  const designar = useMutation({
    mutationFn: (v: { equipe: string; apoio: boolean; excecao: boolean; justificativa?: string }) => apiPost(`/os/${o.id}/despacho`, v),
    onSuccess: depois,
    // 409 (capacidade, despacho ativo…): recarrega a lista para mostrar a carga real
    onError: () => qc.invalidateQueries({ queryKey: ["equipes", o.id] }),
  });
  const remover = useMutation({ mutationFn: (motivo: string) => apiPost(`/os/${o.id}/despacho/remover`, { motivo }), onSuccess: depois });
  const avancar = useMutation({ mutationFn: (passo: PassoDespacho) => apiPost(`/os/${o.id}/despacho/avancar`, { passo }), onSuccess: depois });

  function problemas(r: Recomendacao): string[] {
    return [...(r.apoioIntermunicipal ? ["equipe de outra cidade (apoio intermunicipal)"] : []), ...r.motivosIncompatibilidade.map((m) => `equipe ${m}`)];
  }

  function escolher(r: Recomendacao) {
    designar.reset();
    setBloqueio(null);
    const p = problemas(r);
    if (r.exigeExcecao && !podeExcecao) {
      setBloqueio(`Designação bloqueada: ${p.join("; ")}. Só o Supervisor pode autorizar exceção de despacho. Peça a ele ou escolha outra equipe.`);
      return;
    }
    if (p.length) setAlvo(r);
    else designar.mutate({ equipe: r.equipe, apoio: false, excecao: false });
  }

  const dialogoTitulo = alvo
    ? `${alvo.exigeExcecao ? "Justificativa da exceção" : "Justificativa do apoio intermunicipal"}: ${problemas(alvo).join("; ")}`
    : "";

  // ───── Com equipe designada ─────
  if (desp) {
    const passo = proximoPasso(o.status);
    // Equipe de campo só mexe na própria equipe; a API confere de novo dentro da transação.
    const podeAvancar = podeDesignar || (ator.permissoes.includes("campo") && ator.equipeId === desp.equipe);
    return (
      <>
        <p>
          Equipe designada: <b>{desp.equipe}</b>
          {desp.apoioIntermunicipal && <span className="warn"> Apoio intermunicipal: {desp.apoioJustificativa}</span>}
          {desp.excecaoJustificativa && <span className="warn"> Exceção autorizada: {desp.excecaoJustificativa}</span>}
        </p>
        <p>
          <a className="bt" href={urlMapas(destino)} target="_blank" rel="noopener noreferrer">Navegar até a OS no Maps</a>{" "}
          {ponto(desp.equipeLat, desp.equipeLng) && (
            <a className="bt" href={urlMapas(destino, ponto(desp.equipeLat, desp.equipeLng))} target="_blank" rel="noopener noreferrer">
              Rota a partir da base da equipe
            </a>
          )}
        </p>
        <p className="mu">
          Coordenadas: {osPonto ? `${osPonto.lat.toFixed(5)}, ${osPonto.lng.toFixed(5)}` : "—"} · endereço {o.endereco} · trafo {o.transformador ?? "—"} · UC {o.uc ?? "—"}.{" "}
          {aproximada && <b>Localização aproximada: a OS não tem coordenadas, a rota usa o endereço.</b>}
        </p>
        {passo && (
          <button className="btn-pr mr-1" disabled={!podeAvancar || avancar.isPending} onClick={() => { avancar.reset(); avancar.mutate(passo); }}>
            {PASSOS_DESPACHO[passo].rotulo}
          </button>
        )}
        <button disabled={!podeDesignar || remover.isPending} title={podeDesignar ? undefined : "Seu perfil não tem esta permissão"} onClick={() => { remover.reset(); setRemovendo(true); }}>
          Remover equipe
        </button>
        {avancar.isError && <ErroAcao erro={avancar.error} />}
        {remover.isError && <ErroAcao erro={remover.error} />}
        <JustificativaDialog
          aberto={removendo}
          titulo="Motivo da remoção da equipe"
          onConfirmar={(m) => { setRemovendo(false); remover.mutate(m); }}
          onCancelar={() => setRemovendo(false)}
        />
      </>
    );
  }

  // ───── Sem equipe ─────
  if (!podeDesignar) return <p className="mu">Nenhuma equipe designada.</p>;
  if (o.status !== "Aguardando despacho") {
    return <p className="mu">Esta OS não está em status que permita designar equipe. Coloque-a em &quot;Aguardando despacho&quot; na aba Status.</p>;
  }

  return (
    <>
      <p className="mu">
        Recomendação: compatibilidade e disponibilidade antes da distância. Distância em linha reta (sem rota), sem tempo estimado. &quot;Ir no Maps&quot; abre a rota real, com distância e tempo.
        {o.exigeQualificacao && <> Exige: {o.exigeQualificacao}.</>}
      </p>
      {aproximada && <div className="warn">Esta OS não tem coordenadas: localização aproximada, sem distância calculada.</div>}
      <label className="mu">
        <input type="checkbox" checked={apoio} onChange={(e) => setApoio(e.target.checked)} /> Incluir equipes de outras cidades (apoio intermunicipal, com justificativa)
      </label>

      {recomendadas.isPending ? (
        <Carregando texto="Carregando equipes…" />
      ) : recomendadas.isError ? (
        <ErroApi erro={recomendadas.error} titulo="Não foi possível carregar as equipes." onRetry={() => recomendadas.refetch()} />
      ) : recomendadas.data.length === 0 ? (
        <div className="box">Nenhuma equipe ativa nesta cidade.</div>
      ) : (
        <div className="tw">
          <table className="tabela">
            <thead>
              <tr><th>Equipe</th><th>Cidade</th><th>Carga</th><th>Compatível</th><th>Distância (linha reta)</th><th>Rota</th><th></th></tr>
            </thead>
            <tbody>
              {recomendadas.data.map((r) => (
                <tr key={r.equipe}>
                  <td><b>{r.equipe}</b></td>
                  <td>{r.cidade}{r.apoioIntermunicipal && " (apoio intermunicipal)"}</td>
                  <td className="m">{r.carga}/{r.capacidade}{!r.disponivel && " · cheia"}</td>
                  <td>{r.compativel ? "sim" : `não — ${r.motivosIncompatibilidade.join("; ")}`}</td>
                  <td className="m">{metros(r.distanciaM)}</td>
                  <td>
                    <a className="bt" href={urlMapas(destino, r.base)} target="_blank" rel="noopener noreferrer">Ir no Maps</a>
                  </td>
                  <td>
                    <button disabled={!r.disponivel || designar.isPending} title={r.disponivel ? undefined : "Capacidade esgotada"} onClick={() => escolher(r)}>
                      Designar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {bloqueio && <div className="err" role="alert">{bloqueio}</div>}
      {designar.isError && <ErroAcao erro={designar.error} />}

      <JustificativaDialog
        aberto={alvo !== null}
        titulo={dialogoTitulo}
        onConfirmar={(j) => {
          if (alvo) designar.mutate({ equipe: alvo.equipe, apoio: alvo.apoioIntermunicipal, excecao: alvo.exigeExcecao, justificativa: j });
          setAlvo(null);
        }}
        onCancelar={() => setAlvo(null)}
      />
    </>
  );
}

