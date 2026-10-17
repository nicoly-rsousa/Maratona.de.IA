import type { ModoPublicacao } from "@farol/shared";
import type { Ator, Cidade } from "./types";

/** Nome da cidade selecionada no cabeçalho ("*" = todas, só para quem tem acesso a todas). */
export const nomeDaCidade = (cidade: string, cidades: Cidade[]) =>
  cidade === "*" ? "todas as cidades" : (cidades.find((c) => c.id === cidade)?.nome ?? cidade);

/** Aviso para a Equipe de campo, que só vê as OS da própria equipe (o filtro é do servidor). */
export const notaEquipeCampo = (ator: Ator) =>
  ator.perfil === "Equipe de campo" ? `Você vê só as OS da sua equipe (${ator.equipeId ?? "sem equipe"}).` : null;

/** Rótulos dos modos de publicação de pontuação (§5): fonte única para formulário, histórico e mensagens. */
export const MODO_PUBLICACAO: Record<ModoPublicacao, string> = {
  novas: "Somente novas OS",
  reclassificar: "Reclassificar as OS abertas",
};
