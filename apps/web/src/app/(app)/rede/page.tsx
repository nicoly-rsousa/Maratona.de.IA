"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { redeApi, chavesRede, type OSRedeLeve } from "@/lib/rede-api";
import { CACHE_OS_MS, exigeNovoLogin, filtrarTracado, semCircuitoIdentificado, temPosicao, textoDataImportacao } from "@/lib/rede";
import {
  circuitoDaOS, contornoDoCircuito, coresDosTiposDeChave, limitesDoCircuito, nomeDoTipoDaChave, type CircuitoNoMapa,
} from "@/lib/rede-circuito";
import { temCoordenada } from "@/lib/rede-mapa";
import { estadoDa, useCircuitoRede } from "@/lib/use-circuito-rede";
import { Carregando } from "@/components/ui";
import { PainelOSProximas } from "@/components/rede/painel-os-proximas";
import { ErroRede, Vazio } from "@/components/rede/estados";
import { Legenda } from "@/components/rede/legenda";
import { LegendaCircuito } from "@/components/rede/legenda-circuito";
import { ListaSemCircuito } from "@/components/rede/lista-sem-circuito";
import { MapaRede } from "@/components/rede/mapa-rede";
import { PainelCircuito } from "@/components/rede/painel-circuito";
import { SeletorCircuito } from "@/components/rede/seletor-circuito";

const hora = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const VAZIO: never[] = [];

export default function RedePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [foco, setFoco] = useState<{ numero: string; n: number } | null>(null);
  const [circuitoSel, setCircuitoSel] = useState<string | null>(null);
  const [baixaTensao, setBaixaTensao] = useState(false);
  const pedidos = useRef(0);

  // Porta de entrada: /rede/config decide o acesso no servidor (só o Administrador, por configuração). Sem acesso, nada mais é pedido.
  const config = useQuery({ queryKey: chavesRede.config, queryFn: redeApi.config });
  const liberado = config.isSuccess;
  // /rede/os fica guardado 5 min só neste navegador; "Recarregar dados" força nova busca.
  const osQ = useQuery({ queryKey: chavesRede.os(), queryFn: () => redeApi.os(), enabled: liberado, staleTime: CACHE_OS_MS });
  // lista leve dos circuitos (busca e o que cada um tem na base); os dados pesados só vêm para o circuito selecionado
  const circuitosQ = useQuery({ queryKey: chavesRede.circuitos, queryFn: redeApi.circuitos, enabled: liberado, staleTime: CACHE_OS_MS });

  const itensPorCodigo = useMemo(() => new Map((circuitosQ.data?.circuitos ?? []).map((c) => [c.codigo, c])), [circuitosQ.data]);
  const conhecidos = useMemo(() => new Set(itensPorCodigo.keys()), [itensPorCodigo]);
  const item = circuitoSel ? itensPorCodigo.get(circuitoSel) : undefined;
  const circ = useCircuitoRede(circuitoSel, item, baixaTensao);

  const erros = [config.error, osQ.error, circuitosQ.error, circ.detalhe.error, circ.mediaTensao.error, circ.comBaixaTensao.error, circ.chaves.error, circ.transformadores.error];
  const sessaoExpirada = erros.some(exigeNovoLogin);
  useEffect(() => {
    if (!sessaoExpirada) return;
    void (async () => {
      try { await supabase().auth.signOut(); } catch { /* sem sessão local: segue para o login */ }
      qc.clear();
      router.replace("/login");
    })();
  }, [sessaoExpirada, qc, router]);

  const dados = osQ.data;
  const lista = useMemo(() => dados?.os ?? [], [dados]);
  const porNumero = useMemo(() => new Map(lista.map((o) => [o.numero, o])), [lista]);
  const semCirc = useMemo(() => semCircuitoIdentificado(lista), [lista]);
  const semCoordenada = useMemo(() => lista.filter((o) => !temCoordenada(o)).length, [lista]);
  const osSelecionada: OSRedeLeve | null = (selecionada && porNumero.get(selecionada)) || null;
  const abrivel = osSelecionada && semCircuitoIdentificado([osSelecionada]).length > 0 && osSelecionada.circuito && conhecidos.has(osSelecionada.circuito) ? osSelecionada.circuito : null;

  // ───────── o que o mapa desenha do circuito selecionado ─────────
  const tracado = useMemo(
    () => (baixaTensao && circ.comBaixaTensao.data ? filtrarTracado(circ.comBaixaTensao.data, true) : filtrarTracado(circ.mediaTensao.data, false)),
    [baixaTensao, circ.comBaixaTensao.data, circ.mediaTensao.data],
  );
  const chaves = circ.chaves.data?.features ?? VAZIO;
  const trafos = circ.transformadores.data ?? VAZIO;
  const contorno = useMemo(() => (item ? contornoDoCircuito(item.tem_tracado, circ.chaves.data?.features) : null), [item, circ.chaves.data]);
  const coresChaves = useMemo(() => coresDosTiposDeChave(chaves.map(nomeDoTipoDaChave)), [chaves]);
  // sem bbox na lista, espera OS, chaves e transformadores para enquadrar uma vez só
  const limitesProntos = !!item && (item.bbox !== null || (!circ.detalhe.isLoading && !circ.transformadores.isLoading && !circ.chaves.isLoading));
  const limites = useMemo(
    () => (item && limitesProntos ? limitesDoCircuito({ bbox: item.bbox, os: circ.detalhe.data?.os ?? VAZIO, chaves, transformadores: trafos }) : null),
    [item, limitesProntos, circ.detalhe.data, chaves, trafos],
  );
  const circuitoNoMapa = useMemo<CircuitoNoMapa | null>(
    () => (item ? { codigo: item.codigo, tracado, chaves: [...chaves], transformadores: trafos, coresChaves, contorno, limites } : null),
    [item, tracado, chaves, trafos, coresChaves, contorno, limites],
  );

  const escolherCircuito = (codigo: string | null) => {
    setCircuitoSel(codigo);
    setBaixaTensao(false); // baixa tensão desligada por padrão em cada circuito
  };
  const aoSelecionarOS = (numero: string) => {
    setSelecionada(numero);
    const o = porNumero.get(numero);
    const c = o ? circuitoDaOS(o, conhecidos) : null; // OS de alimentador não identificado nunca abre circuito sozinha
    if (c) escolherCircuito(c);
  };
  const verNoMapa = (numero: string) => {
    setSelecionada(numero);
    setFoco({ numero, n: ++pedidos.current });
  };

  let corpo;
  if (sessaoExpirada) {
    corpo = <div className="warn" role="status">Sua sessão expirou. Redirecionando para o login…</div>;
  } else if (config.isPending) {
    corpo = <Carregando texto="Verificando seu acesso ao Mapa da rede…" />;
  } else if (config.isError) {
    corpo = <ErroRede erro={config.error} titulo="Não foi possível verificar seu acesso." onRetry={() => config.refetch()} />;
  } else if (osQ.isPending) {
    corpo = <Carregando texto="Carregando as OS…" />;
  } else if (osQ.isError) {
    corpo = <ErroRede erro={osQ.error} titulo="Não foi possível carregar as OS." onRetry={() => osQ.refetch()} />;
  } else if (!dados || dados.total === 0) {
    corpo = (
      <>
        <Vazio texto="Nenhuma OS importada. Rode a importação e recarregue." />
        <button type="button" onClick={() => osQ.refetch()} disabled={osQ.isFetching}>Recarregar dados</button>
      </>
    );
  } else {
    corpo = (
      <>
        <div className="rede-toolbar">
          <p className="mu" style={{ margin: 0 }} aria-live="polite">
            <b className="text-tx">{dados.total.toLocaleString("pt-BR")} OS</b> · {textoDataImportacao(dados.importado_em)} ·
            carregado neste navegador às {hora(osQ.dataUpdatedAt)} (guardado por 5 min)
          </p>
          <button type="button" onClick={() => osQ.refetch()} disabled={osQ.isFetching}>
            {osQ.isFetching ? "Atualizando…" : "Recarregar dados"}
          </button>
          <a href="#lista-sem-circuito" className="bt sr-only focus:not-sr-only">Pular o mapa</a>
        </div>
        {semCoordenada > 0 && (
          <div className="warn" role="note">
            {semCoordenada.toLocaleString("pt-BR")} OS sem coordenada válida não aparecem no mapa (estão só nas contagens).
          </div>
        )}
        <div className="rede-workspace">
          <section className="rede-map-card" aria-label="Área principal do mapa">
            <MapaRede
              os={lista} selecionada={selecionada} onSelecionar={aoSelecionarOS} foco={foco} rotulo="Mapa da rede: OS importadas"
              circuito={circuitoNoMapa} circuitoDestaque={circuitoSel}
              altura="max(560px, calc(100dvh - 170px))"
            />
          </section>
          <aside className="rede-sidebar" aria-label="Painel e legenda da rede">
            <SeletorCircuito
              circuitos={circuitosQ.data?.circuitos} carregando={circuitosQ.isLoading} erro={circuitosQ.error}
              selecionado={circuitoSel} onSelecionar={escolherCircuito} onRetry={() => circuitosQ.refetch()}
            />
            {circuitoSel && !item && !circuitosQ.isLoading && (
              <div className="warn" role="note">O alimentador {circuitoSel} não está na lista de alimentadores.</div>
            )}
            {item && (
              <>
                <PainelCircuito
                  item={item} detalhe={estadoDa(circ.detalhe)} chaves={estadoDa(circ.chaves)}
                  tracado={estadoDa(circ.mediaTensao)} transformadores={estadoDa(circ.transformadores)}
                  baixaTensao={baixaTensao} baixaTensaoCarregando={circ.comBaixaTensao.isLoading} baixaTensaoErro={circ.comBaixaTensao.error}
                  onBaixaTensao={setBaixaTensao} contorno={contorno} onLimpar={() => escolherCircuito(null)}
                  onVerNoMapa={verNoMapa} selecionadaOS={selecionada}
                />
                <LegendaCircuito
                  tracado={tracado} chaves={chaves} coresChaves={coresChaves} contorno={contorno}
                  qtdTransformadoresNoMapa={trafos.filter(temPosicao).length}
                />
              </>
            )}
            <Legenda os={lista} />
            <PainelOSProximas
              key={osSelecionada?.numero ?? "sem-selecao"}
              os={osSelecionada} todas={lista} circuitoAbrivel={abrivel}
              onAbrirCircuito={escolherCircuito} onVerNoMapa={verNoMapa}
            />
          </aside>
        </div>
        <ListaSemCircuito os={semCirc} selecionada={selecionada} onVerNoMapa={verNoMapa} />
      </>
    );
  }

  return (
    <div className="rede-page">
      <h2>Mapa da rede</h2>
      <p className="mu" style={{ marginTop: 0 }}>
        Visão geral das OS importadas, coloridas pela prioridade legada mapeada. É informativa: não é a fila de prioridade do Farol e não altera nenhuma ordem.
      </p>
      {corpo}
    </div>
  );
}
