"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { redeApi, chavesRede } from "@/lib/rede-api";
import { CACHE_OS_MS, exigeNovoLogin, semCircuitoIdentificado, textoDataImportacao } from "@/lib/rede";
import { temCoordenada } from "@/lib/rede-mapa";
import { Carregando } from "@/components/ui";
import { DetalheOS } from "@/components/rede/detalhe-os";
import { ErroRede, Vazio } from "@/components/rede/estados";
import { Legenda } from "@/components/rede/legenda";
import { ListaSemCircuito } from "@/components/rede/lista-sem-circuito";
import { MapaRede } from "@/components/rede/mapa-rede";

const hora = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export default function RedePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [foco, setFoco] = useState<{ numero: string; n: number } | null>(null);
  const pedidos = useRef(0);

  // Porta de entrada: /rede/config decide o acesso no servidor (só o Administrador, por configuração). Sem acesso, nada mais é pedido.
  const config = useQuery({ queryKey: chavesRede.config, queryFn: redeApi.config });
  const liberado = config.isSuccess;
  // /rede/os fica guardado 5 min só neste navegador; "Recarregar dados" força nova busca.
  const osQ = useQuery({ queryKey: chavesRede.os(), queryFn: () => redeApi.os(), enabled: liberado, staleTime: CACHE_OS_MS });

  const sessaoExpirada = exigeNovoLogin(config.error) || exigeNovoLogin(osQ.error);
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
  const semCirc = useMemo(() => semCircuitoIdentificado(lista), [lista]);
  const semCoordenada = useMemo(() => lista.filter((o) => !temCoordenada(o)).length, [lista]);
  const osSelecionada = useMemo(() => lista.find((o) => o.numero === selecionada) ?? null, [lista, selecionada]);

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
        <div className="row" style={{ marginBottom: 8 }}>
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
        <div className="grid gap-3 [grid-template-columns:minmax(0,1fr)_340px] max-[900px]:[grid-template-columns:minmax(0,1fr)]">
          <MapaRede os={lista} selecionada={selecionada} onSelecionar={setSelecionada} foco={foco} rotulo="Mapa da rede: OS importadas" />
          <div>
            <Legenda os={lista} />
            <DetalheOS os={osSelecionada} />
          </div>
        </div>
        <ListaSemCircuito os={semCirc} selecionada={selecionada} onVerNoMapa={verNoMapa} />
      </>
    );
  }

  return (
    <div>
      <h2>Mapa da rede</h2>
      <p className="mu" style={{ marginTop: 0 }}>
        Visão geral das OS importadas, coloridas pela prioridade legada mapeada. É informativa: não é a fila de prioridade do Farol e não altera nenhuma ordem.
      </p>
      {corpo}
    </div>
  );
}
