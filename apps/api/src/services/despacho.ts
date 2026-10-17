import { ESTADOS_DESPACHO_ATIVOS, type DespachoResumo, type EquipeCandidata, type EstadoDespacho, type EventoOS } from "@farol/shared";
import { db } from "../db.js";

export const ehAtivo = (estado: string) => (ESTADOS_DESPACHO_ATIVOS as readonly string[]).includes(estado);

/** Despachos da OS (mais recente primeiro), com a base da equipe para a rota. */
export async function despachosDaOS(osId: string): Promise<DespachoResumo[]> {
  const { data, error } = await db.from("despachos").select("*").eq("os_id", osId).order("designada_em", { ascending: false });
  if (error) throw new Error(error.message);
  const ids = [...new Set((data ?? []).map((d) => d.equipe_id as string))];
  const { data: eqs, error: e2 } = ids.length ? await db.from("equipes").select("id, lat, lng").in("id", ids) : { data: [], error: null };
  if (e2) throw new Error(e2.message);
  const base = new Map((eqs ?? []).map((e) => [e.id as string, e]));
  return (data ?? []).map((d) => ({
    id: d.id, equipe: d.equipe_id, estado: d.estado as EstadoDespacho,
    apoioIntermunicipal: d.apoio_intermunicipal, apoioJustificativa: d.apoio_justificativa, excecaoJustificativa: d.excecao_justificativa,
    designadaEm: d.designada_em, aCaminhoEm: d.a_caminho_em, emExecucaoEm: d.em_execucao_em,
    concluidaEm: d.concluida_em, removidaEm: d.removida_em, removidaMotivo: d.removida_motivo,
    equipeLat: base.get(d.equipe_id)?.lat ?? null, equipeLng: base.get(d.equipe_id)?.lng ?? null,
  }));
}

export async function eventosDaOS(osId: string): Promise<EventoOS[]> {
  const { data, error } = await db.from("eventos_os").select("id, tipo, de, para, motivo, usuario, em, detalhe")
    .eq("os_id", osId).order("em", { ascending: false }).order("id", { ascending: false });
  if (error) throw new Error(error.message);
  const ids = [...new Set((data ?? []).map((e) => e.usuario as string | null).filter((x): x is string => !!x))];
  const { data: ps } = ids.length ? await db.from("perfis").select("user_id, nome").in("user_id", ids) : { data: [] };
  const nomes = new Map((ps ?? []).map((p) => [p.user_id as string, p.nome as string]));
  return (data ?? []).map((e) => ({
    id: e.id, tipo: e.tipo, de: e.de, para: e.para, motivo: e.motivo, equipe: (e.detalhe as { equipe?: string } | null)?.equipe ?? null, usuario: e.usuario ? (nomes.get(e.usuario) ?? null) : null, em: e.em,
  }));
}

/** Equipes ativas das cidades pedidas, com a carga atual (despachos ativos). */
export async function equipesCandidatas(cidades: string[]): Promise<EquipeCandidata[]> {
  const { data, error } = await db.from("equipes").select("id, cidade_id, capacidade, qualificacoes, lat, lng").eq("ativa", true).in("cidade_id", cidades);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((e) => e.id as string);
  const cargas = new Map<string, number>();
  if (ids.length) {
    const { data: ds, error: e2 } = await db.from("despachos").select("equipe_id").in("equipe_id", ids).in("estado", [...ESTADOS_DESPACHO_ATIVOS]);
    if (e2) throw new Error(e2.message);
    for (const d of ds ?? []) cargas.set(d.equipe_id, (cargas.get(d.equipe_id) ?? 0) + 1);
  }
  return (data ?? []).map((e) => ({
    id: e.id, cidade: e.cidade_id, capacidade: e.capacidade, qualificacoes: (e.qualificacoes as string[]) ?? [],
    lat: e.lat, lng: e.lng, carga: cargas.get(e.id) ?? 0,
  }));
}

/** OS (ids) com despacho ativo da equipe: a visão da Equipe de campo. */
export async function osDaEquipe(equipeId: string): Promise<string[]> {
  const { data, error } = await db.from("despachos").select("os_id").eq("equipe_id", equipeId).in("estado", [...ESTADOS_DESPACHO_ATIVOS]);
  if (error) throw new Error(error.message);
  return (data ?? []).map((d) => d.os_id as string);
}
