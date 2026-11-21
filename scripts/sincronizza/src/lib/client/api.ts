// ZoomZoom — client API helper. Tutte le chiamate sono relative (stessa origine),
// sessioni gestite via cookie httpOnly dal server.
export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error: string; [k: string]: unknown };

export async function api<T = Record<string, unknown>>(
  path: string,
  options: { method?: string; body?: unknown; form?: FormData } = {}
): Promise<ApiResult<T>> {
  try {
    const init: RequestInit = { method: options.method || (options.body || options.form ? "POST" : "GET") };
    if (options.form) {
      init.body = options.form;
    } else if (options.body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(options.body);
    }
    const res = await fetch(path, init);
    const data = (await res.json().catch(() => ({ ok: false, error: "Risposta non valida dal server." }))) as ApiResult<T>;
    return data;
  } catch {
    return { ok: false, error: "Impossibile contattare il server: verifica la connessione." };
  }
}

export const fmt1 = (x: number | null | undefined): string =>
  x == null ? "—" : new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x);
export const fmtInt = (x: number | null | undefined): string =>
  x == null ? "—" : new Intl.NumberFormat("it-IT").format(x);

const MONTHS = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];
export function fmtMonthYear(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " +
    d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}
