"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AddCircleOutline from "@mui/icons-material/AddCircleOutlineOutlined";
import ArrowForward from "@mui/icons-material/ArrowForward";
import Send from "@mui/icons-material/Send";
import { NovaOSSchema, TIPOS_MANUTENCAO, TRANSFORMADOR_RE, UC_RE, temLocalizacao, valorInicial } from "@farol/shared";
import { api, apiPost } from "@/lib/api";
import { consultaDuplicidade } from "@/lib/consultas";
import { nomeDaCidade } from "@/lib/escopo";
import { mensagemDeErro } from "@/lib/format";
import type { CriteriosNova, OSCriada, Vinculada } from "@/lib/types";
import { Alerta } from "@/components/alerta";
import { CabecalhoPagina } from "@/components/cabecalho-pagina";
import { CampoFormulario } from "@/components/campo";
import { EstadoConsulta, SemCidade } from "@/components/estados";
import { Icone } from "@/components/icone";
import { Pill } from "@/components/prioridade";
import { useApp } from "../app-context";
import { SeletorPonto } from "./seletor-ponto";
import { SugestoesDuplicidade } from "./sugestoes-duplicidade";

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

/** Opção "Desconhecido/Desconhecida" sempre por último, como no protótipo. */
const desconhecidaPorUltimo = <T extends { desconhecida: boolean }>(ops: T[]) => [...ops.filter((o) => !o.desconhecida), ...ops.filter((o) => o.desconhecida)];

/** Campo do NovaOSSchema → id do controle na tela (para mostrar o erro junto do campo e levar o foco até ele). */
const ID_DO_CAMPO: Record<string, string> = {
  cidade: "n_cid", endereco: "n_end", lat: "n_lat", lng: "n_lng", transformador: "n_tr", uc: "n_uc",
  circuito: "n_circ", conjunto: "n_conj", tipo: "n_tipo", prazoH: "n_prazo", exigeQualificacao: "n_qual",
};
/** Mensagens legíveis para os erros genéricos do Zod (faixa numérica, tipo). As mensagens próprias do schema são mantidas. */
const MSG_PADRAO: Record<string, string> = {
  cidade: "Escolha o município.",
  lat: "Latitude de -90 a 90, em graus decimais com ponto.",
  lng: "Longitude de -180 a 180, em graus decimais com ponto.",
  prazoH: "Informe o prazo em horas (número) ou deixe vazio.",
};

interface Erros {
  /** por id do controle */
  campos: Record<string, string>;
  /** erros sem campo (resposta da API) */
  gerais: string[];
}
const SEM_ERROS: Erros = { campos: {}, gerais: [] };

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
  const [erros, setErros] = useState<Erros>(SEM_ERROS);
  const [criada, setCriada] = useState<OSCriada | null>(null);
  const [vinculada, setVinculada] = useState<Vinculada | null>(null);

  // Qualquer mudança nos dados invalida a ciência da duplicidade e os avisos anteriores.
  const mudar = <T,>(set: (v: T) => void) => (v: T) => { set(v); setCiente(false); setErros(SEM_ERROS); };

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
  const qsDup = new URLSearchParams(Object.entries(consulta).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)])).toString();
  const dup = useQuery({
    ...consultaDuplicidade(qsDup),
    enabled: podeNova && cidade !== "" && temChave && !criada && !vinculada,
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
    const campos: Record<string, string> = {};
    for (const [campo, v] of [["lat", latN], ["lng", lngN], ["prazoH", numero(prazoH)]] as const) {
      if (typeof v === "number" && Number.isNaN(v)) campos[ID_DO_CAMPO[campo]!] = "Número inválido.";
    }
    const gerais: string[] = [];
    const r = NovaOSSchema.safeParse(bruto);
    if (!r.success) {
      for (const i of r.error.issues) {
        const [campo, sub] = i.path.map(String);
        const id = campo === "fatos" && sub ? `n_${sub}` : campo ? ID_DO_CAMPO[campo] : undefined;
        const msg = i.code === "custom" || i.code === "invalid_string" ? i.message : (MSG_PADRAO[campo ?? ""] ?? i.message);
        if (id) campos[id] ??= msg;
        else gerais.push(msg);
      }
    }
    const ok = r.success && Object.keys(campos).length === 0 && gerais.length === 0;
    return { dados: ok ? r.data : null, erros: { campos, gerais } };
  }

  const criar = useMutation({
    mutationFn: (dados: unknown) => apiPost<OSCriada>("/os", dados),
    onSuccess: (r) => { setCriada(r); qc.invalidateQueries({ queryKey: ["fila"] }); },
    onError: (e) => setErros({ campos: {}, gerais: [mensagemDeErro(e)] }),
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
    onError: (e) => setErros({ campos: {}, gerais: [mensagemDeErro(e)] }),
  });

  async function registrar(e: FormEvent) {
    e.preventDefault();
    const { dados, erros: novos } = montar();
    if (!dados) {
      setErros(novos);
      // leva o foco ao primeiro campo com erro (o resumo também lista todos)
      const primeiro = Object.keys(ID_DO_CAMPO).map((k) => ID_DO_CAMPO[k]!).concat(perguntas.map((p) => `n_${p.id}`)).find((id) => novos.campos[id]);
      if (primeiro) requestAnimationFrame(() => document.getElementById(primeiro)?.focus());
      return;
    }
    setErros(SEM_ERROS);
    // Consulta fresca: o atendente pode ter clicado antes do atraso da digitação.
    let achadas = sugestoes;
    if (temChave) {
      try {
        achadas = await qc.fetchQuery(consultaDuplicidade(qsDup));
      } catch { /* sem a checagem, não bloqueia o registro: a sugestão é auxiliar */ }
    }
    if (achadas.length && !ciente) { setCiente(true); return; }
    criar.mutate(dados);
  }

  function novaSolicitacao() {
    setEndereco(""); setLat(""); setLng(""); setTransformador(""); setUc(""); setCircuito(""); setConjunto("");
    setTipo("Corretiva"); setPrazoH(""); setQualificacao(""); setEscolhas({}); setObservacao("");
    setCiente(false); setErros(SEM_ERROS); setCriada(null); setVinculada(null);
  }

  const cabecalho = (
    <CabecalhoPagina
      titulo="Nova solicitação"
      descricao="Registre o pedido do cliente. Antes de criar a OS, o sistema sugere possíveis duplicidades na mesma cidade."
    />
  );

  if (!podeNova) {
    return <>{cabecalho}<Alerta tipo="error" role="alert" titulo="Sem permissão.">O perfil {ator.perfil} não registra solicitações.</Alerta></>;
  }
  if (cidades.length === 0) {
    return <>{cabecalho}<SemCidade /></>;
  }

  if (criada || vinculada) {
    return (
      <>
        {cabecalho}
        {criada && (
          <Alerta tipo="success" role="status" titulo={<>OS <span className="font-mono">{criada.os.numero}</span> registrada</>}>
            <div className="summary my-2">
              <div className="summary__item"><span className="summary__label">Prioridade</span><span className="summary__value"><Pill codigo={criada.resultado.codigo} /></span></div>
              <div className="summary__item"><span className="summary__label">Nível</span><span className="summary__value font-mono">{criada.resultado.nivel}</span></div>
              <div className="summary__item"><span className="summary__label">Pontos</span><span className="summary__value font-mono">{criada.resultado.pontos}</span></div>
              <div className="summary__item"><span className="summary__label">Status</span><span className="summary__value">{criada.os.status}</span></div>
            </div>
            <p className="text-muted">{criada.resultado.motivoPrincipal}</p>
          </Alerta>
        )}
        {criada?.os.status === "Em triagem" && (
          <Alerta tipo="warning">Sem localização válida (latitude e longitude): a OS entrou <b>Em triagem</b> até alguém confirmar o local.</Alerta>
        )}
        {vinculada && (
          <Alerta tipo="success" role="status" titulo={<>Solicitação vinculada à <span className="font-mono">{vinculada.numero}</span></>}>
            {vinculada.total ?? "?"} solicitações nesta OS. Nenhuma OS nova foi criada.
            {vinculada.reclassificada && <> A prioridade da OS foi recalculada.</>}
          </Alerta>
        )}
        <div className="button-group">
          {criada && <Link href={`/os/${criada.os.id}`} className="button button--primary"><Icone de={ArrowForward} />Abrir OS</Link>}
          <button type="button" className="button" onClick={novaSolicitacao}><Icone de={AddCircleOutline} />Registrar outra solicitação</button>
        </div>
      </>
    );
  }

  const ocupado = criar.isPending || vincular.isPending;
  const semLocal = !temLocalizacao(latN, lngN);
  const digitouCoord = lat.trim() !== "" || lng.trim() !== "";
  const ponto = !semLocal ? { lat: latN as number, lng: lngN as number } : null;
  const erroDe = (id: string) => erros.campos[id];
  const qtdErros = Object.keys(erros.campos).length + erros.gerais.length;

  return (
    <>
<<<<<<< HEAD
      {cabecalho}
      <form className="card" onSubmit={registrar} noValidate aria-label="Nova solicitação">
        <fieldset className="form-group">
          <legend className="form-group__legend">Local <span className="form-group__hint">— sem localização válida a OS entra Em triagem</span></legend>
          <div className="form-grid">
            <CampoFormulario id="n_cid" rotulo="Município" obrigatorio erro={erroDe("n_cid")}>
              {(a) => (
                <select {...a} className="control" value={cidade} onChange={(e) => { mudar(setCidadeSel)(e.target.value); setEscolhas({}); setQualificacao(""); }}>
                  {cidades.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              )}
            </CampoFormulario>
            <CampoFormulario
              id="n_end" rotulo="Endereço" obrigatorio className="form-grid__wide" erro={erroDe("n_end")}
              dica="Sozinho não indica duplicidade (§11): informe também UC, transformador ou coordenadas."
            >
              {(a) => <input {...a} className="control" value={endereco} onChange={(e) => mudar(setEndereco)(e.target.value)} autoComplete="off" />}
            </CampoFormulario>
            <CampoFormulario id="n_lat" rotulo="Latitude" dica="Graus decimais, ex.: -19.9167" erro={erroDe("n_lat")}>
              {(a) => <input {...a} className="control control--mono" value={lat} onChange={(e) => mudar(setLat)(e.target.value)} inputMode="decimal" autoComplete="off" placeholder="-19.9167" />}
            </CampoFormulario>
            <CampoFormulario id="n_lng" rotulo="Longitude" dica="Graus decimais, ex.: -43.9345" erro={erroDe("n_lng")}>
              {(a) => <input {...a} className="control control--mono" value={lng} onChange={(e) => mudar(setLng)(e.target.value)} inputMode="decimal" autoComplete="off" placeholder="-43.9345" />}
            </CampoFormulario>
            {digitouCoord && semLocal && !erroDe("n_lat") && !erroDe("n_lng") && (
              <div className="form-grid__wide">
                <Alerta tipo="warning" role="status">Coordenadas incompletas ou inválidas: latitude de -90 a 90 e longitude de -180 a 180 (graus decimais, com ponto).</Alerta>
              </div>
            )}
            <SeletorPonto
              cidade={cidade} cidadeNome={nomeDaCidade(cidade, cidades)} ponto={ponto}
              onEscolher={(p) => { mudar(setLat)(String(p.lat)); mudar(setLng)(String(p.lng)); }}
            />
=======
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
                      {sel?.requerConfirmacao && <span id={`${id}_rc`} className="mu" title="requer confirmação"><span aria-hidden="true">*</span><span className="sr-only">requer confirmação</span></span>}
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
        <p className="mu">
          Tem várias para registrar de uma vez? <Link href="/nova/importar" className="text-ac underline">Importar de um arquivo CSV</Link>.
        </p>

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
>>>>>>> 70f612613baaea41e96096aa9c5b0e731ed1826e
          </div>
        </fieldset>

        <fieldset className="form-group">
          <legend className="form-group__legend">Identificação na rede</legend>
          <div className="form-grid">
            <CampoFormulario id="n_tr" rotulo="Transformador" dica="Texto numérico de 4 a 12 dígitos." erro={erroDe("n_tr")}>
              {(a) => <input {...a} className="control control--mono" value={transformador} onChange={(e) => mudar(setTransformador)(e.target.value)} inputMode="numeric" autoComplete="off" />}
            </CampoFormulario>
            <CampoFormulario id="n_uc" rotulo="UC" dica="Unidade consumidora: 6 a 10 dígitos." erro={erroDe("n_uc")}>
              {(a) => <input {...a} className="control control--mono" value={uc} onChange={(e) => mudar(setUc)(e.target.value)} inputMode="numeric" autoComplete="off" />}
            </CampoFormulario>
            <CampoFormulario id="n_circ" rotulo="Circuito" dica="Opcional." erro={erroDe("n_circ")}>
              {(a) => <input {...a} className="control" value={circuito} onChange={(e) => mudar(setCircuito)(e.target.value)} />}
            </CampoFormulario>
            <CampoFormulario id="n_conj" rotulo="Conjunto" dica="Opcional." erro={erroDe("n_conj")}>
              {(a) => <input {...a} className="control" value={conjunto} onChange={(e) => mudar(setConjunto)(e.target.value)} />}
            </CampoFormulario>
          </div>
        </fieldset>

        <fieldset className="form-group">
          <legend className="form-group__legend">Atendimento</legend>
          <div className="form-grid">
            <CampoFormulario id="n_tipo" rotulo="Tipo" erro={erroDe("n_tipo")}>
              {(a) => (
                <select {...a} className="control" value={tipo} onChange={(e) => mudar(setTipo)(e.target.value as typeof tipo)}>
                  {(criterios.data?.tipos ?? TIPOS_MANUTENCAO).map((t) => <option key={t}>{t}</option>)}
                </select>
              )}
            </CampoFormulario>
            <CampoFormulario id="n_prazo" rotulo="Prazo-limite (horas)" dica="Vazio = sem prazo." erro={erroDe("n_prazo")}>
              {(a) => <input {...a} className="control control--mono" value={prazoH} onChange={(e) => mudar(setPrazoH)(e.target.value)} inputMode="decimal" autoComplete="off" />}
            </CampoFormulario>
            <CampoFormulario id="n_qual" rotulo="Exige qualificação" erro={erroDe("n_qual")}>
              {(a) => (
                <select {...a} className="control" value={qualificacao} onChange={(e) => mudar(setQualificacao)(e.target.value)}>
                  <option value="">Nenhuma</option>
                  {(criterios.data?.qualificacoes ?? []).map((q) => <option key={q}>{q}</option>)}
                </select>
              )}
            </CampoFormulario>
          </div>
        </fieldset>

        <fieldset className="form-group">
          <legend className="form-group__legend">
            Critérios de prioridade{criterios.data && <span className="form-group__hint"> — versão v{criterios.data.versao} publicada</span>}
          </legend>
          <EstadoConsulta consulta={criterios} carregando="Carregando critérios da versão publicada…" erro="Não foi possível carregar os critérios.">
            {() => (
              <>
                <div className="form-grid">
                  {perguntas.map((p) => {
                    const id = `n_${p.id}`;
                    const sel = p.opcoes.find((o) => o.label === valorDe(p.id));
                    return (
                      <CampoFormulario key={p.id} id={id} rotulo={p.nome} erro={erroDe(id)} dica={sel?.requerConfirmacao ? "Esta opção requer confirmação." : undefined}>
                        {/* §3: dado não informado nunca vale zero; o valor inicial é a opção "Desconhecido" (valorInicial). */}
                        {(a) => (
                          <select {...a} className="control" value={valorDe(p.id)} onChange={(e) => mudar((v: string) => setEscolhas((x) => ({ ...x, [p.id]: v })))(e.target.value)}>
                            {!p.opcoes.some((o) => o.desconhecida) && <option value="">Não informado</option>}
                            {desconhecidaPorUltimo(p.opcoes).map((o) => <option key={o.label} value={o.label}>{o.label}</option>)}
                          </select>
                        )}
                      </CampoFormulario>
                    );
                  })}
                </div>
                <p className="text-muted">
                  Não sabe um dado? Deixe a opção &quot;Desconhecido&quot;: ela soma pontos e pede confirmação, nunca vale zero. Tempo de espera e prazo são calculados pelo sistema.
                </p>
              </>
            )}
          </EstadoConsulta>
        </fieldset>

        {qtdErros > 0 && (
          <Alerta tipo="error" role="alert" titulo="Corrija antes de registrar">
            <ul className="list-disc pl-5">
              {Object.entries(erros.campos).map(([id, msg]) => (
                <li key={id}><a className="link" href={`#${id}`}>{msg}</a></li>
              ))}
              {erros.gerais.map((m) => <li key={m}>{m}</li>)}
            </ul>
          </Alerta>
        )}

        <div className="card__footer">
          <button type="submit" className="button button--primary" disabled={ocupado || criterios.isPending || criterios.isError}>
            <Icone de={Send} />
            {criar.isPending ? "Registrando…" : ciente && sugestoes.length > 0 ? "Não é duplicada, criar nova OS" : "Registrar solicitação"}
          </button>
          {temChave && dup.isFetching && sugestoes.length === 0 && <span className="inline-status" role="status">Verificando duplicidade…</span>}
          {dup.isError && <span className="inline-status">Não foi possível verificar duplicidade agora; o registro continua disponível.</span>}
        </div>
      </form>

      {sugestoes.length > 0 && (
        <SugestoesDuplicidade
          sugestoes={sugestoes} ocupado={ocupado} observacao={observacao}
          onObservacao={setObservacao} onVincular={(id) => vincular.mutate(id)}
        />
      )}
    </>
  );
}
