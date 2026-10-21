"use client";

import type { Contorno } from "@farol/shared";
import { Carregando } from "@/components/ui";
import type { Chaves, CircuitoResumo, DetalheCircuito, Tracado, TransformadorRede } from "@/lib/rede-api";
import { AVISO_ORDEM_INFORMATIVA, estiloDaPrioridade, formatarClientes, resumirTransformadores, resumoDeClientes, TEXTO_APOIO_TRANSFORMADORES, textoSemPosicao } from "@/lib/rede";
import { descreverRede, textoDoContorno } from "@/lib/rede-circuito";
import type { EstadoConsulta } from "@/lib/use-circuito-rede";
import { ErroRede } from "./estados";

const n = (v: number) => v.toLocaleString("pt-BR");

/** Painel do circuito selecionado: clientes, o que a base tem da rede, baixa tensão, transformadores e as OS dele. */
export function PainelCircuito({
  item, detalhe, chaves, tracado, transformadores, baixaTensao, baixaTensaoCarregando, baixaTensaoErro, onBaixaTensao, contorno, onLimpar, onVerNoMapa, selecionadaOS,
}: {
  item: CircuitoResumo;
  detalhe: EstadoConsulta<DetalheCircuito>;
  chaves: EstadoConsulta<Chaves>;
  tracado: EstadoConsulta<Tracado>;
  transformadores: EstadoConsulta<TransformadorRede[]>;
  baixaTensao: boolean;
  baixaTensaoCarregando: boolean;
  baixaTensaoErro: unknown;
  onBaixaTensao: (ligada: boolean) => void;
  contorno: Contorno | null;
  onLimpar: () => void;
  onVerNoMapa: (numero: string) => void;
  selecionadaOS: string | null;
}) {
  const cli = resumoDeClientes(item);
  const rede = descreverRede(item);
  const trafos = resumirTransformadores(transformadores.dados);
  const qtdChaves = chaves.dados?.features.length ?? 0;
  const textoContorno = textoDoContorno(contorno, qtdChaves);
  return (
    <section className="box rede-circuit-panel" aria-labelledby="painel-circuito-titulo">
      <div className="rede-panel-heading">
        <h3 id="painel-circuito-titulo" style={{ margin: 0 }}>Alimentador <span className="m">{item.codigo}</span></h3>
        <button type="button" onClick={onLimpar}>Limpar seleção</button>
      </div>

      <h4 style={{ margin: "10px 0 2px", fontSize: 13 }}>Clientes</h4>
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px" }}>
        <dt className="mu">Total</dt><dd style={{ margin: 0 }}>{cli.total}</dd>
        <dt className="mu">Ligados</dt><dd style={{ margin: 0 }}>{cli.ligados}</dd>
        <dt className="mu">Desligados</dt><dd style={{ margin: 0 }}>{cli.desligados}</dd>
      </dl>

      <h4 style={{ margin: "10px 0 2px", fontSize: 13 }}>Rede na base</h4>
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px" }}>
        <dt className="mu">Traçado</dt><dd style={{ margin: 0 }}>{item.tem_tracado ? "Sim (real, por trecho)" : "Não (aproximado)"}</dd>
        <dt className="mu">Chaves</dt><dd style={{ margin: 0 }}>{rede.chaves > 0 ? n(rede.chaves) : "sem chaves na base"}</dd>
        <dt className="mu">OS do alimentador</dt><dd style={{ margin: 0 }}>{n(item.qtd_os)}</dd>
      </dl>
      <p className="mu" style={{ margin: "4px 0" }}>{rede.mensagem}</p>
      {!item.tem_tracado && chaves.carregando && <Carregando texto="Carregando as chaves…" />}
      {chaves.erro != null && <ErroRede erro={chaves.erro} titulo="Não foi possível carregar as chaves." onRetry={chaves.refazer} />}
      {!item.tem_tracado && textoContorno && <p className="warn" role="note">{textoContorno}</p>}
      {item.tem_tracado && tracado.carregando && <Carregando texto="Carregando o traçado…" />}
      {tracado.erro != null && <ErroRede erro={tracado.erro} titulo="Não foi possível carregar o traçado." onRetry={tracado.refazer} />}

      {item.tem_tracado && (
        <div style={{ margin: "6px 0" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={baixaTensao} onChange={(e) => onBaixaTensao(e.target.checked)} />
            Mostrar baixa tensão (LV)
          </label>
          <span className="mu">Desligada por padrão: só a média tensão é desenhada. A cor continua sendo a do trecho.</span>
          {baixaTensao && baixaTensaoCarregando && <Carregando texto="Carregando a baixa tensão…" />}
          {baixaTensaoErro != null && <ErroRede erro={baixaTensaoErro} titulo="Não foi possível carregar a baixa tensão." />}
        </div>
      )}

      <h4 style={{ margin: "10px 0 2px", fontSize: 13 }}>Transformadores</h4>
      {transformadores.carregando && <Carregando texto="Carregando os transformadores…" />}
      {transformadores.erro != null && <ErroRede erro={transformadores.erro} titulo="Não foi possível carregar os transformadores." onRetry={transformadores.refazer} />}
      {transformadores.dados && (
        trafos.total === 0 ? (
          <p className="mu" style={{ margin: 0 }}>Nenhum transformador na base para este alimentador.</p>
        ) : (
          <>
            <p style={{ margin: 0 }}>
              {n(trafos.total)} transformadores · {formatarClientes(trafos.clientesIdentificados)} clientes identificados
            </p>
            <p style={{ margin: "2px 0" }}>
              {n(trafos.comPosicao)} no mapa (círculo com o nº de clientes identificados) · {textoSemPosicao(trafos.semPosicao)}
            </p>
            <p className="mu" style={{ margin: "2px 0" }}>{TEXTO_APOIO_TRANSFORMADORES}</p>
          </>
        )
      )}

      <h4 style={{ margin: "10px 0 2px", fontSize: 13 }}>OS do alimentador</h4>
      <p className="mu" style={{ margin: "0 0 4px" }}>{AVISO_ORDEM_INFORMATIVA}</p>
      {detalhe.carregando && <Carregando texto="Carregando as OS do alimentador…" />}
      {detalhe.erro != null && <ErroRede erro={detalhe.erro} titulo="Não foi possível carregar as OS do alimentador." onRetry={detalhe.refazer} />}
      {detalhe.dados && (
        detalhe.dados.os.length === 0 ? (
          <p className="mu" style={{ margin: 0 }}>Nenhuma OS importada neste alimentador.</p>
        ) : (
          <div className="tw" style={{ maxHeight: 260, overflow: "auto" }}>
            <table className="tabela">
              <caption className="sr-only">OS do alimentador {item.codigo}, em ordem informativa</caption>
              <thead><tr><th scope="col">OS</th><th scope="col">Prioridade legada</th><th scope="col"><span className="sr-only">Ação</span></th></tr></thead>
              <tbody>
                {detalhe.dados.os.map((o) => (
                  <tr key={o.numero} className="r" aria-selected={o.numero === selecionadaOS}>
                    <td className="m">{o.numero}</td>
                    <td>{o.prioridade_legada ?? "—"} <span className="mu">({estiloDaPrioridade(o.prioridade_codigo).rotulo})</span></td>
                    <td><button type="button" onClick={() => onVerNoMapa(o.numero)} aria-label={`Ver a OS ${o.numero} no mapa`}>Ver no mapa</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
  );
}
