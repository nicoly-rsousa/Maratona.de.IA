import { supabase } from "./supabase";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Requisição autenticada na API (Bearer = token do Supabase Auth). Filtros de cidade/perfil são do servidor. */
async function chamar<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw new ApiError(0, "NEXT_PUBLIC_API_URL não configurada.");

  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, "Sessão expirada. Entre novamente.");

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError(0, "Não foi possível falar com o servidor.");
  }
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { erro?: unknown } | null;
    throw new ApiError(res.status, typeof corpo?.erro === "string" ? corpo.erro : `Erro ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = <T>(path: string) => chamar<T>(path);

/** POST com corpo JSON. */
export const apiPost = <T>(path: string, corpo: unknown) => chamar<T>(path, { method: "POST", body: JSON.stringify(corpo) });
