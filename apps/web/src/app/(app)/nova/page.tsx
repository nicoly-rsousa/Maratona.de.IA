"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  NovaOSSchema, TIPOS_MANUTENCAO, TRANSFORMADOR_RE, UC_RE, temLocalizacao, valorInicial,
  type MotivoDuplicidade,
} from "@farol/shared";
import { api, apiPost } from "@/lib/api";
import { minutosDesde } from "@/lib/format";
import type { CriteriosNova, OSCriada, Sugestao, Vinculada } from "@/lib/types";
import type { RespostaMapa } from "@farol/shared";
import { Mapa } from "@/components/mapa";
import { Carregando, ErroApi, Pill } from "@/components/ui";
import { useApp } from "../app-context";

const MOTIVO: Record<MotivoDuplicidade, string> = {
  proximidade: "próxima",
  mesmo_transformador: "mesmo transformador",
  mesma_uc: "mesma UC",
  mesmo_conjunto_e_tipo: "mesmo conjunto e tipo",
};

const vazio = (s: string) => (s.trim() === "" ? undefined : s.trim());
const numero = (s: string) => (s.trim() === "" ? undefined : Number(s.trim().replace(",", ".")));

function useAtraso<T>(valor: T, ms: number): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

/** Rótulo + campo, como no protótipo (.row label): sem texto de ajuda dentro do label, para a linha de base não variar. */
function Campo({ id, rotulo, className, children }: { id: string; rotulo: string; className?: string; children: ReactNode }) {
  return (
    <label htmlFor={id} className={className}>
      {rotulo}
      {children}
    </label>
  );
}

/** Opção "Desconhecido/Desconhecida" sempre por último, como no protótipo. */
const desconhecidaPorUltimo = <T extends { desconhecida: boolean }>(ops: T[]) => [...ops.filter((o) => !o.desconhecida), ...ops.filter((o) => o.desconhecida)];

export default function NovaSolicitacaoPage() {
  const { ator, cidades, cidade: cidadeHeader } = useApp();
  const qc = useQueryClient();
  const podeNova = ator.permissoes.includes("nova");

  const [cidadeSel, setCidadeSel] = useState<string>("");
  const cidade = cidades.some((c) => c.id === cidadeSel) ? cidadeSel : cidades.some((c) => c.id === cidadeHeader) ? cidadeHeader : (cidades[0]?.id ?? "");

  const [endereco, setEndereco] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [transformador, setTransformador] = useState("");
  const [uc, setUc] = useState("");
  const [circuito, setCircuito] = useState("");
  const [conjunto, setConjunto] = useState("");
  const [tipo, setTipo] = useState<(typeof TIPOS_MANUTENCAO)[number]>("Corretiva");
  const [prazoH, setPrazoH] = useState("");
  const [qualificacao, setQualificacao] = useState("");
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [observacao, setObservacao] = useState("");
  const [ciente, setCiente] = useState(false);
  const [erros, setErros] = useState<string[]>([]);
  const [criada, setCriada] = useState<OSCriada | null>(null);
  const [vinculada, setVinculada] = useState<Vinculada | null>(null);
  const [mostrarMapa, setMostrarMapa] = useState(false);

  // Qualquer mudança nos dados invalida a ciência da duplicidade e os avisos anteriores.
  const mudar = <T,>(set: (v: T) => void) => (v: T) => { set(v); setCiente(false); setErros([]); };

  const criterios = useQuery({
    queryKey: ["criterios", cidade],
    queryFn: () => api<CriteriosNova>(`/os/criterios?cidade=${encodeURIComponent(cidade)}`),
    enabled: podeNova && cidade !== "",
  });
  const perguntas = criterios.data?.perguntas ?? [];

  // Mapa para escolher o ponto: só consulta quando aberto; mostra as OS abertas da cidade (ajuda a ver duplicidade).
  const mapa = useQuery({
    queryKey: ["mapa", cidade],
    queryFn: () => api<RespostaMapa>(`/mapa?cidade=${encodeURIComponent(cidade)}`),
    enabled: podeNova && cidade !== "" && mostrarMapa,
  });
  const valorDe = (id: string) => escolhas[id] ?? valorInicial(perguntas.find((p) => p.id === id)!);

  // ── duplicidade (§11): só consulta com um meio de localização que conta (UC, transformador, coordenadas, conjunto)
  const latN = numero(lat);
  const lngN = numero(lng);
  const consulta = useAtraso(
    {
      cidade, endereco: vazio(endereco), tipo, conjunto: vazio(conjunto),
      transformador: TRANSFORMADOR_RE.test(transformador.trim()) ? transformador.trim() : undefined,
      uc: UC_RE.test(uc.trim()) ? uc.trim() : undefined,
      lat: temLocalizacao(latN, lngN) ? latN : undefined,
      lng: temLocalizacao(latN, lngN) ? lngN : undefined,
    },
    500,
  );
  const temChave = !!(consulta.transformador || consulta.uc || consulta.lat != null || consulta.conjunto);
  const qsDup = (c: typeof consulta) =>
    new URLSearchParams(Object.entries(c).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)])).toString();
  const dup = useQuery({
    queryKey: ["duplicidade", qsDup(consulta)],
    queryFn: () => api<Sugestao[]>(`/os/duplicidade?${qsDup(consulta)}`),
    enabled: podeNova && cidade !== "" && temChave && !criada && !vinculada,
    staleTime: 0,
  });
  const sugestoes = temChave ? (dup.data ?? []) : [];

  function montar() {
    const fatos: Record<string, string> = {};
    for (const p of perguntas) { const v = valorDe(p.id); if (v) fatos[p.id] = v; }
    const bruto = {
      cidade, endereco, lat: latN, lng: lngN, transformador: vazio(transformador), uc: vazio(uc),
      circuito: vazio(circuito), conjunto: vazio(conjunto), exigeQualificacao: vazio(qualificacao),
      tipo, prazoH: numero(prazoH) ?? null, fatos,
    };
    const nan = [["Latitude", latN], ["Longitude", lngN], ["Prazo-limite", numero(prazoH)]].filter(([, v]) => typeof v === "number" && Number.isNaN(v)).map(([k]) => `${k}: número inválido.`);
    const r = NovaOSSchema.safeParse(bruto);
    const msgs = [...nan, ...(r.success ? [] : r.error.issues.map((i) => (i.path.length ? `${String(i.path[0])}: ` : "") + i.message))];
    return { dados: r.success && !nan.length ? r.data : null, msgs };
  }

  const criar = useMutation({
    mutationFn: (dados: unknown) => apiPost<OSCriada>("/os", dados),
    onSuccess: (r) => { setCriada(r); qc.invalidateQueries({ queryKey: ["fila"] }); },
    onError: (e) => setErros([e instanceof Error ? e.message : "Erro desconhecido."]),
  });

  const vincular = useMutation({
    mutationFn: (osId: string) => {
      const fatos: Record<string, string> = {};
      for (const [k, v] of Object.entries(escolhas)) if (v) fatos[k] = v;
      return apiPost<Vinculada>(`/os/${osId}/solicitacoes`, {
        endereco: vazio(endereco), lat: temLocalizacao(latN, lngN) ? latN : undefined, lng: temLocalizacao(latN, lngN) ? lngN : undefined,
        transformador: vazio(transformador), uc: vazio(uc), observacao: vazio(observacao), fatos,
      });
    },
    onSuccess: (r) => { setVinculada(r); qc.invalidateQueries({ queryKey: ["fila"] }); qc.invalidateQueries({ queryKey: ["os"] }); },
    onError: (e) => setErros([e instanceof Error ? e.message : "Erro desconhecido."]),
  });

  async function registrar() {
    const { dados, msgs } = montar();
    if (!dados) { setErros(msgs); return; }
    setErros([]);
    // Consulta fresca: o atendente pode ter clicado antes do atraso da digitação.
    let achadas = sugestoes;
    if (temChave) {
      try {
        achadas = await qc.fetchQuery({ queryKey: ["duplicidade", qsDup(consulta)], queryFn: () => api<Sugestao[]>(`/os/duplicidade?${qsDup(consulta)}`), staleTime: 0 });
      } catch { /* sem a checagem, não bloqueia o registro: a sugestão é auxiliar */ }
    }
    if (achadas.length && !ciente) { setCiente(true); return; }
    criar.mutate(dados);
  }

  function novaSolicitacao() {
    setEndereco(""); setLat(""); setLng(""); setTransformador(""); setUc(""); setCircuito(""); setConjunto("");
    setTipo("Corretiva"); setPrazoH(""); setQualificacao(""); setEscolhas({}); setObservacao("");
    setCiente(false); setErros([]); setCriada(null); setVinculada(null);
  }

  if (!podeNova) {
    return <div className="err" role="alert"><b>Sem permissão.</b> O perfil {ator.perfil} não registra solicitações.</div>;
  }
  if (cidades.length === 0) {
    return <div className="warn">Seu usuário não tem cidade vinculada. Peça a um administrador para vinculá-lo a um município.</div>;
  }

  if (criada || vinculada) {
    return (
      <>
        <h2>Nova solicitação</h2>
        {criada && (
          <div className="okm" role="status">
            Registrada: <b className="m">{criada.os.numero}</b> — <Pill codigo={criada.resultado.codigo} /> · nível{" "}
            <b className="m">{criada.resultado.nivel}</b> · <b className="m">{criada.resultado.pontos}</b> pts · {criada.os.status}
            <p className="mu">{criada.resultado.motivoPrincipal}</p>
            {criada.os.status === "Em triagem" && (
              <div className="warn">Sem localização válida (latitude e longitude): a OS entrou <b>Em triagem</b> até alguém confirmar o local.</div>
            )}
            <p><Link href={`/os/${criada.os.id}`} className="text-ac underline">Abrir OS</Link></p>
          </div>
        )}
        {vinculada && (
          <div className="okm" role="status">
            Solicitação vinculada à <b className="m">{vinculada.numero}</b> ({vinculada.total ?? "?"} solicitações). Nenhuma OS nova foi criada.
            {vinculada.reclassificada && <> A prioridade da OS foi recalculada.</>}
          </div>
        )}
        <button onClick={novaSolicitacao}>Registrar outra solicitação</button>
      </>
    );
  }

  const ocupado = criar.isPending || vincular.isPending;
  const semLocal = !temLocalizacao(latN, lngN);
  const digitouCoord = lat.trim() !== "" || lng.trim() !== "";
  const ponto = !semLocal ? { lat: latN as number, lng: lngN as number } : null;

  return (
    <>
      <h2>Nova solicitação</h2>
      <div className="box">
        <div className="row">
          <Campo id="n_cid" rotulo="Município">
            <select id="n_cid" value={cidade} onChange={(e) => { mudar(setCidadeSel)(e.target.value); setEscolhas({}); setQualificacao(""); }}>
              {cidades.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Campo>
          <Campo id="n_end" rotulo="Endereço" className="min-w-[220px] flex-1">
            <input id="n_end" value={endereco} onChange={(e) => mudar(setEndereco)(e.target.value)} autoComplete="off" />
          </Campo>
          <Campo id="n_lat" rotulo="Coord. Latitude">
            <input id="n_lat" className="w-[80px]" value={lat} onChange={(e) => mudar(setLat)(e.target.value)} inputMode="decimal" autoComplete="off" placeholder="-19.9167" />
          </Campo>
          <Campo id="n_lng" rotulo="Longitude">
            <input id="n_lng" className="w-[80px]" value={lng} onChange={(e) => mudar(setLng)(e.target.value)} inputMode="decimal" autoComplete="off" placeholder="-43.9345" />
          </Campo>
          <Campo id="n_tr" rotulo="Transformador (texto, ≥ 4 dígitos)">
            <input id="n_tr" value={transformador} onChange={(e) => mudar(setTransformador)(e.target.value)} inputMode="numeric" autoComplete="off" />
          </Campo>
          <Campo id="n_uc" rotulo="UC (6–10 dígitos)">
            <input id="n_uc" value={uc} onChange={(e) => mudar(setUc)(e.target.value)} inputMode="numeric" autoComplete="off" />
          </Campo>
          <Campo id="n_circ" rotulo="Circuito (opcional)">
            <input id="n_circ" value={circuito} onChange={(e) => mudar(setCircuito)(e.target.value)} />
          </Campo>
          <Campo id="n_conj" rotulo="Conjunto (opcional)">
            <input id="n_conj" value={conjunto} onChange={(e) => mudar(setConjunto)(e.target.value)} />
          </Campo>
          <Campo id="n_tipo" rotulo="Tipo">
            <select id="n_tipo" value={tipo} onChange={(e) => mudar(setTipo)(e.target.value as typeof tipo)}>
              {(criterios.data?.tipos ?? TIPOS_MANUTENCAO).map((t) => <option key={t}>{t}</option>)}
            </select>
          </Campo>
          <Campo id="n_prazo" rotulo="Prazo-limite (h, vazio = sem)">
            <input id="n_prazo" className="w-[90px]" value={prazoH} onChange={(e) => mudar(setPrazoH)(e.target.value)} inputMode="decimal" autoComplete="off" />
          </Campo>
          <Campo id="n_qual" rotulo="Exige qualificação">
            <select id="n_qual" value={qualificacao} onChange={(e) => mudar(setQualificacao)(e.target.value)}>
              <option value="">Nenhuma</option>
              {(criterios.data?.qualificacoes ?? []).map((q) => <option key={q}>{q}</option>)}
            </select>
          </Campo>
        </div>
        <p className="mu">Sozinho não indica duplicidade (§11); informe também UC, transformador ou coordenadas.</p>
        <p className="mu">Sem localização válida a OS entra Em triagem.</p>

        {digitouCoord && semLocal && (
          <div className="warn" role="status">Coordenadas incompletas ou inválidas: latitude de -90 a 90 e longitude de -180 a 180 (graus decimais, com ponto).</div>
        )}
        <p>
          <button type="button" aria-expanded={mostrarMapa} onClick={() => setMostrarMapa((v) => !v)}>
            {mostrarMapa ? "Ocultar o mapa" : "Escolher o ponto no mapa"}
          </button>
          <span className="mu"> Também dá para digitar latitude e longitude acima.</span>
        </p>
        {mostrarMapa && (
          mapa.isPending ? (
            <Carregando texto="Carregando o mapa…" />
          ) : mapa.isError ? (
            <ErroApi erro={mapa.error} titulo="Não foi possível carregar o mapa." onRetry={() => mapa.refetch()} />
          ) : mapa.data && (
            <>
              <p className="mu">Clique no mapa para preencher latitude e longitude. O círculo mostra o raio de {mapa.data.raioM} m da sugestão de duplicidade; os pontos coloridos são as OS abertas.</p>
              <Mapa
                os={mapa.data.os} equipes={[]} mostrarEquipes={false} selecionadaId={null}
                raioM={mapa.data.raioM} centro={mapa.data.centro} chave={cidade} rotulo={`Mapa para escolher o local em ${cidade}`}
                altura={340} ponto={ponto}
                onClicar={(p) => { mudar(setLat)(String(p.lat)); mudar(setLng)(String(p.lng)); }}
              />
            </>
          )
        )}

        <h3>Critérios de prioridade{criterios.data && <span className="mu font-normal"> — versão v{criterios.data.versao} publicada</span>}</h3>
        {criterios.isPending ? (
          <Carregando texto="Carregando critérios da versão publicada…" />
        ) : criterios.isError ? (
          <ErroApi erro={criterios.error} titulo="Não foi possível carregar os critérios." onRetry={() => criterios.refetch()} />
        ) : (
          <>
            <div className="row">
              {perguntas.map((p) => {
                const id = `n_${p.id}`;
                const sel = p.opcoes.find((o) => o.label === valorDe(p.id));
                return (
                  <Campo key={p.id} id={id} rotulo={p.nome}>
                    <span className="flex items-center gap-1">
                      {/* §3: dado não informado nunca vale zero; o valor inicial é a opção "Desconhecido" (valorInicial). */}
                      <select id={id} value={valorDe(p.id)} aria-describedby={sel?.requerConfirmacao ? `${id}_rc` : undefined} onChange={(e) => mudar((v: string) => setEscolhas((x) => ({ ...x, [p.id]: v })))(e.target.value)}>
                        {!p.opcoes.some((o) => o.desconhecida) && <option value="">Não informado</option>}
                        {desconhecidaPorUltimo(p.opcoes).map((o) => <option key={o.label} value={o.label}>{o.label}</option>)}
                      </select>
                      {sel?.requerConfirmacao && <span id={`${id}_rc`} className="mu whitespace-nowrap text-[11px]">requer confirmação</span>}
                    </span>
                  </Campo>
                );
              })}
            </div>
            <p className="mu">Não sabe um dado? Deixe a opção &quot;Desconhecido&quot;: ela soma pontos e pede confirmação, nunca vale zero. Tempo de espera e prazo são calculados pelo sistema.</p>
          </>
        )}
        <button className="pr" disabled={ocupado || criterios.isPending || criterios.isError} onClick={registrar}>
          {criar.isPending ? "Registrando…" : ciente && sugestoes.length > 0 ? "Não é duplicada, criar nova OS" : "Registrar solicitação"}
        </button>

        {temChave && dup.isFetching && sugestoes.length === 0 && <p className="mu" role="status">Verificando duplicidade…</p>}
        {dup.isError && <p className="mu">Não foi possível verificar duplicidade agora; o registro continua disponível.</p>}
        {sugestoes.length > 0 && (
          <div className="warn" role="alert">
            <b>Possível duplicidade (sugestão, nunca automática).</b> OS abertas da mesma cidade nas últimas horas:
            <div className="tw">
              <table className="tabela">
                <tbody>
                  {sugestoes.map((s) => (
                    <tr key={s.id}>
                      <td><Link href={`/os/${s.id}`} target="_blank" className="m text-ac underline">{s.numero}</Link></td>
                      <td><Pill codigo={s.codigo} /></td>
                      <td>{s.endereco}</td>
                      <td className="m">
                        {s.distanciaM != null && `${s.distanciaM} m · `}{s.motivos.map((m) => MOTIVO[m]).join(", ")}
                        {s.mesmoEndereco && " · mesmo endereço"}
                      </td>
                      <td className="m">{s.status} · há {minutosDesde(new Date(s.abertaEmMs).toISOString())} min</td>
                      <td><button disabled={ocupado} onClick={() => vincular.mutate(s.id)}>Vincular a esta OS</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row">
              <Campo id="n_obs" rotulo="Observação para o vínculo (opcional)">
                <input id="n_obs" value={observacao} maxLength={500} onChange={(e) => setObservacao(e.target.value)} />
              </Campo>
            </div>
          </div>
        )}

        {erros.length > 0 && (
          <div className="err" role="alert"><b>Corrija antes de registrar:</b><br />{erros.map((e) => <div key={e}>{e}</div>)}</div>
        )}

      </div>
    </>
  );
}
