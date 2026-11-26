"use client";
// ZoomZoom — hash router minimale per la SPA a route unica.
// DOVE ERI: l'utente che accede per completare un'azione (recensire, votare,
// ordinare…) torna dove era, non sul profilo: ogni pagina visitata che NON è
// una pagina di autenticazione viene ricordata in sessionStorage; al termine
// dell'accesso si riprende da lì (altrimenti home, con la barra di ricerca).
import { useCallback, useEffect, useState } from "react";

export type Route = { segs: string[]; params: Record<string, string>; hash: string };

export function parseHash(hRaw: string): Route {
  const h = hRaw || "#/";
  const parts = h.slice(1).split("?");
  const segs = parts[0].split("/").filter(Boolean);
  const params: Record<string, string> = {};
  if (parts[1]) {
    for (const kv of parts[1].split("&")) {
      const p = kv.split("=");
      if (p[0]) params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || "");
    }
  }
  return { segs, params, hash: h };
}

// pagine di autenticazione: non si ricordano come punto di ritorno (il
// ritorno è SEMPRE una pagina di contenuto, mai la pagina di accesso stessa)
const AUTH_HASHES = ["#/accedi", "#/registrati", "#/verifica-email"];
const RETURN_KEY = "zz.returnTo";

function isAuthHash(h: string): boolean {
  return AUTH_HASHES.some(p => h === p || h.startsWith(p + "?"));
}

// ricorda la pagina di contenuto visitata (sessionStorage: non sopravvive
// a un'altra scheda, non inquina i cookie — è una preferenza tecnica)
export function rememberRoute(h: string): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    if (!h || h === "#/" || h === "#" || isAuthHash(h)) return;
    window.sessionStorage.setItem(RETURN_KEY, h);
  } catch { /* storage non disponibile: si atterra sulla home */ }
}

// punto di ritorno: la pagina ricordata, ripulita; se manca (o non è valida)
// si atterra sulla pagina indicata come alternativa (di norma la home)
export function popReturnTo(fallback = "#/"): string {
  if (typeof window === "undefined") return fallback;
  try {
    const h = window.sessionStorage.getItem(RETURN_KEY);
    window.sessionStorage.removeItem(RETURN_KEY);
    if (h && h.startsWith("#/") && !isAuthHash(h)) return h;
  } catch { /* come sopra */ }
  return fallback;
}

export function useHashRoute(): Route {
  // Il primo render usa la route predefinita (come sul server): l'hash reale
  // viene letto in un effetto, dopo l'idratazione, così gli attributi del
  // primo albero client coincidono con quelli prerenderizzati.
  const [route, setRoute] = useState<Route>(() => parseHash("#/"));
  useEffect(() => {
    const onChange = () => {
      const h = window.location.hash;
      setRoute(parseHash(h));
      rememberRoute(h);
    };
    onChange();
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(hash: string) {
  if (typeof window === "undefined") return;
  window.location.hash = hash;
}

export function useNavigate() {
  return useCallback((hash: string) => navigate(hash), []);
}
