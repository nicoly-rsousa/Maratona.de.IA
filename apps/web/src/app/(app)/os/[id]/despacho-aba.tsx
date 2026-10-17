"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AssignmentInd from "@mui/icons-material/AssignmentInd";
import DirectionsOutlined from "@mui/icons-material/DirectionsOutlined";
import PersonRemoveOutlined from "@mui/icons-material/PersonRemoveOutlined";
import PlayArrow from "@mui/icons-material/PlayArrow";
import {
  PASSOS_DESPACHO, proximoPasso, urlMapas,
  type DetalheOS, type PassoDespacho, type PontoMapa, type Recomendacao,
} from "@farol/shared";
import { api, apiPost } from "@/lib/api";
import { formatarMetros } from "@/lib/format";
import type { Ator } from "@/lib/types";
import { Alerta, ErroAcao } from "@/components/alerta";
import { CampoCheckbox } from "@/components/campo";
import { EstadoConsulta, EstadoVazio } from "@/components/estados";
import { Icone } from "@/components/icone";
import { JustificativaDialog } from "@/components/justificativa-dialog";
import { LinkExterno } from "@/components/link-externo";
import { Tabela } from "@/components/tabela";

const ponto = (lat: number | null, lng: number | null): PontoMapa | null => (lat != null && lng != null ? { lat, lng } : null);

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
      setBloqueio(`${p.join("; ")}. Só o Supervisor pode autorizar exceção de despacho. Peça a ele ou escolha outra equipe.`);
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
    const base = ponto(desp.equipeLat, desp.equipeLng);
    return (
      <>
        <dl className="summary">
          <div className="summary__item"><dt className="summary__label">Equipe designada</dt><dd className="summary__value">{desp.equipe}</dd></div>
          <div className="summary__item"><dt className="summary__label">Status</dt><dd className="summary__value">{o.status}</dd></div>
        </dl>
        {desp.apoioIntermunicipal && <Alerta tipo="info" titulo="Apoio intermunicipal">{desp.apoioJustificativa}</Alerta>}
        {desp.excecaoJustificativa && <Alerta tipo="warning" titulo="Exceção autorizada">{desp.excecaoJustificativa}</Alerta>}
        <div className="button-group">
          <LinkExterno href={urlMapas(destino)} className="button button--sm"><Icone de={DirectionsOutlined} />Navegar até a OS no Maps</LinkExterno>
          {base && (
            <LinkExterno href={urlMapas(destino, base)} className="button button--sm"><Icone de={DirectionsOutlined} />Rota a partir da base da equipe</LinkExterno>
          )}
        </div>
        <p className="text-muted">
          Coordenadas: <span className="font-mono">{osPonto ? `${osPonto.lat.toFixed(5)}, ${osPonto.lng.toFixed(5)}` : "—"}</span> · endereço {o.endereco} · trafo {o.transformador ?? "—"} · UC {o.uc ?? "—"}.
        </p>
        {aproximada && <Alerta tipo="warning">Localização aproximada: a OS não tem coordenadas, a rota usa o endereço.</Alerta>}
        <div className="card__footer">
          {passo && (
            <button
              type="button" className="button button--primary" aria-describedby={!podeAvancar ? "despacho-sem-permissao" : undefined}
              disabled={!podeAvancar || avancar.isPending} onClick={() => { avancar.reset(); avancar.mutate(passo); }}
            >
              <Icone de={PlayArrow} />{PASSOS_DESPACHO[passo].rotulo}
            </button>
          )}
          <button
            type="button" className="button button--danger" aria-describedby={!podeDesignar ? "despacho-sem-permissao" : undefined}
            disabled={!podeDesignar || remover.isPending} onClick={() => { remover.reset(); setRemovendo(true); }}
          >
            <Icone de={PersonRemoveOutlined} />Remover equipe
          </button>
          {/* motivo visível do botão desabilitado (podeDesignar implica podeAvancar) */}
          {!podeDesignar && (
            <span id="despacho-sem-permissao" className="button-group__note">
              {passo && !podeAvancar ? "Seu perfil não tem permissão para estas ações." : "Seu perfil não pode remover a equipe."}
            </span>
          )}
        </div>
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
  if (!podeDesignar) return <p className="text-muted">Nenhuma equipe designada.</p>;
  if (o.status !== "Aguardando despacho") {
    return <p className="text-muted">Esta OS não está em status que permita designar equipe. Coloque-a em &quot;Aguardando despacho&quot; na aba Status.</p>;
  }

  return (
    <>
      <p className="text-muted">
        Recomendação: compatibilidade e disponibilidade antes da distância. Distância em linha reta (sem rota), sem tempo estimado. &quot;Ir no Maps&quot; abre a rota real, com distância e tempo.
        {o.exigeQualificacao && <> Exige: {o.exigeQualificacao}.</>}
      </p>
      {aproximada && <Alerta tipo="warning">Esta OS não tem coordenadas: localização aproximada, sem distância calculada.</Alerta>}
      <CampoCheckbox rotulo="Incluir equipes de outras cidades (apoio intermunicipal, com justificativa)" checked={apoio} onChange={setApoio} />

      <EstadoConsulta consulta={recomendadas} carregando="Carregando equipes…" erro="Não foi possível carregar as equipes.">
        {(lista) => lista.length === 0 ? (
          <EstadoVazio>Nenhuma equipe ativa nesta cidade.</EstadoVazio>
        ) : (
          <Tabela legenda="Equipes recomendadas">
            <thead>
              <tr>
                <th scope="col">Equipe</th><th scope="col">Cidade</th><th scope="col">Carga</th><th scope="col">Compatível</th>
                <th scope="col">Distância (linha reta)</th><th scope="col">Rota</th><th scope="col"><span className="sr-only">Ação</span></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((r) => (
                <tr key={r.equipe}>
                  <td><b>{r.equipe}</b></td>
                  <td>{r.cidade}{r.apoioIntermunicipal && " (apoio intermunicipal)"}</td>
                  <td className="data-table__cell--num">{r.carga}/{r.capacidade}{!r.disponivel && " · cheia"}</td>
                  <td className="data-table__cell--wrap">{r.compativel ? "sim" : `não — ${r.motivosIncompatibilidade.join("; ")}`}</td>
                  <td className="data-table__cell--num">{formatarMetros(r.distanciaM)}</td>
                  <td>
                    <LinkExterno href={urlMapas(destino, r.base)} className="link" rotulo={`Ir no Maps a partir da base da ${r.equipe}`}>Ir no Maps</LinkExterno>
                  </td>
                  <td className="data-table__cell--actions">
                    {r.disponivel ? (
                      <button
                        type="button" className="button button--sm" disabled={designar.isPending} onClick={() => escolher(r)}
                        aria-label={`Designar a equipe ${r.equipe}`}
                      >
                        <Icone de={AssignmentInd} />Designar
                      </button>
                    ) : (
                      <span className="text-muted">Capacidade esgotada</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </EstadoConsulta>
      {bloqueio && <Alerta tipo="error" role="alert" titulo="Designação bloqueada">{bloqueio}</Alerta>}
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
