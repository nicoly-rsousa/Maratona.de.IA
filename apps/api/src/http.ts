import { z } from "zod";

/** Erros do Zod em um texto único para o front (o corpo `erro` é sempre string). */
export const mensagens = (e: { issues: { path: (string | number)[]; message: string }[] }) =>
  e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message).join(" ");

/** Id de linha (uuid) vindo da URL. */
export const idValido = (id: string) => z.string().uuid().safeParse(id).success;
