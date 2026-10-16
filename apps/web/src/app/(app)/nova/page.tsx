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

function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mu">{rotulo}</span>
      {children}
      {dica && <span className="mu text-[11px]">{dica}</span>}
    </label>
  );
}

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

  // Qualquer mudança nos dados invalida a ciência da duplicidade e os avisos anteriores.
  const mudar = <T,>(set: (v: T) => void) => (v: T) => { set(v); setCiente(false); setErros([]); };

  const criterios = useQuery({
    queryKey: ["criterios", cidade],
    queryFn: () => api<CriteriosNova>(`/os/criterios?cidade=${encodeURIComponent(cidade)}`),
    enabled: podeNova && cidade !== "",
  });
  const perguntas = criterios.data?.perguntas ?? [];
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
          <div className="box" role="status">
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
          <div className="box" role="status">
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

  return (
    <>
      <h2>Nova solicitação</h2>
      <div className="box">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3">
          <Campo rotulo="Município">
            <select value={cidade} onChange={(e) => { mudar(setCidadeSel)(e.target.value); setEscolhas({}); setQualificacao(""); }}>
              {cidades.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Endereço" dica="Sozinho não indica duplicidade (§11); informe também UC, transformador ou coordenadas.">
            <input value={endereco} onChange={(e) => mudar(setEndereco)(e.target.value)} autoComplete="off" />
          </Campo>
          <Campo rotulo="Latitude (graus decimais)">
            <input value={lat} onChange={(e) => mudar(setLat)(e.target.value)} inputMode="decimal" placeholder="-19.9167" />
          </Campo>
          <Campo rotulo="Longitude (graus decimais)" dica={semLocal ? "Sem localização válida a OS entra Em triagem." : undefined}>
            <input value={lng} onChange={(e) => mudar(setLng)(e.target.value)} inputMode="decimal" placeholder="-43.9345" />
          </Campo>
          <Campo rotulo="Transformador (texto, 4 a 12 dígitos)">
            <input value={transformador} onChange={(e) => mudar(setTransformador)(e.target.value)} inputMode="numeric" autoComplete="off" />
          </Campo>
          <Campo rotulo="UC (6 a 10 dígitos)">
            <input value={uc} onChange={(e) => mudar(setUc)(e.target.value)} inputMode="numeric" autoComplete="off" />
          </Campo>
          <Campo rotulo="Circuito (opcional)">
            <input value={circuito} onChange={(e) => mudar(setCircuito)(e.target.value)} />
          </Campo>
          <Campo rotulo="Conjunto (opcional)">
            <input value={conjunto} onChange={(e) => mudar(setConjunto)(e.target.value)} />
          </Campo>
          <Campo rotulo="Tipo de manutenção">
            <select value={tipo} onChange={(e) => mudar(setTipo)(e.target.value as typeof tipo)}>
              {(criterios.data?.tipos ?? TIPOS_MANUTENCAO).map((t) => <option key={t}>{t}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Prazo-limite (horas a partir de agora; vazio = sem prazo)">
            <input value={prazoH} onChange={(e) => mudar(setPrazoH)(e.target.value)} inputMode="decimal" />
          </Campo>
          <Campo rotulo="Exige qualificação">
            <select value={qualificacao} onChange={(e) => mudar(setQualificacao)(e.target.value)}>
              <option value="">Nenhuma</option>
              {(criterios.data?.qualificacoes ?? []).map((q) => <option key={q}>{q}</option>)}
            </select>
          </Campo>
        </div>

        <h3>Critérios de prioridade{criterios.data && <span className="mu font-normal"> — versão v{criterios.data.versao} publicada</span>}</h3>
        {criterios.isPending ? (
          <Carregando texto="Carregando critérios da versão publicada…" />
        ) : criterios.isError ? (
          <ErroApi erro={criterios.error} titulo="Não foi possível carregar os critérios." onRetry={() => criterios.refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3">
              {perguntas.map((p) => (
                <Campo key={p.id} rotulo={p.nome}>
                  <select value={valorDe(p.id)} onChange={(e) => mudar((v: string) => setEscolhas((x) => ({ ...x, [p.id]: v })))(e.target.value)}>
                    {!p.opcoes.some((o) => o.desconhecida) && <option value="">Não informado</option>}
                    {p.opcoes.map((o) => (
                      <option key={o.label} value={o.label}>{o.label}{o.requerConfirmacao ? " (requer confirmação)" : ""}</option>
                    ))}
                  </select>
                </Campo>
              ))}
            </div>
            <p className="mu">Não sabe um dado? Deixe a opção &quot;Desconhecido&quot;: ela soma pontos e pede confirmação, nunca vale zero. Tempo de espera e prazo são calculados pelo sistema.</p>
          </>
        )}

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
            <Campo rotulo="Observação para o vínculo (opcional)">
              <input value={observacao} maxLength={500} onChange={(e) => setObservacao(e.target.value)} />
            </Campo>
          </div>
        )}

        {erros.length > 0 && (
          <div className="err" role="alert"><b>Corrija antes de registrar:</b><br />{erros.map((e) => <div key={e}>{e}</div>)}</div>
        )}

        <p>
          <button className="btn-pr" disabled={ocupado || criterios.isPending || criterios.isError} onClick={registrar}>
            {criar.isPending ? "Registrando…" : ciente && sugestoes.length > 0 ? "Não é duplicada, criar nova OS" : "Registrar solicitação"}
          </button>
        </p>
      </div>
    </>
  );
}
