"use client";
// ZoomZoom — store applicativo client: bootstrap (config pubblica dal server),
// sessione utente, toast, consenso cookie. Nessun segreto o sessione in
// localStorage: solo la preferenza di zona (non sensibile, stile cookie tecnico).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";

export type CategoryInfo = {
  id: string; name: string; shortName: string; description: string;
  hexColor: string; icon: string; isPerson: boolean; isMapped: boolean;
  criteria: { key: string; label: string }[];
  experienceKinds: string[];
  priceUnits: string[];
};
export type ZoneInfo = {
  id: string; name: string;
  // campi opzionali (retrocompatibili): presenti sulle zone nuove,
  // assenti sui payload salvati in cache dal client
  province?: string | null; region?: string | null;
  lat?: number; lng?: number;
};
export type SessionUser = {
  id: string; email: string; nickname: string; role: string;
  emailVerified: boolean; subjectEntityId: string | null;
  totpEnabled: boolean; isDemo: boolean; createdAt: string;
  premium: { active: boolean; until: string | null };
  photoAccess?: boolean;
  photoViaContribution?: boolean;
};
export type Bootstrap = {
  site: {
    name: string; tagline: string; demoMode: boolean;
    emailDelivery: "smtp" | "demo" | "disabled";
    googleOAuthEnabled: boolean; adsEnabled: boolean; adsClient: string;
    premiumEnabled: boolean;
    openReviewsEnabled: boolean;
    photosEnabled: boolean;
    votesEnabled: boolean;
  };
  categories: CategoryInfo[];
  zones: ZoneInfo[];
  settings: {
    minReviews: number; rettificaDays: number; inviteExpiryDays: number;
    heroTitle: string; heroSub: string; globalNotice: string;
    premiumDaysPerReview: number;
  };
  stats: { reviews: number; entities: number };
  user: SessionUser | null;
};

export type Toast = { id: number; msg: string; kind: "ok" | "err" };

type Ctx = {
  boot: Bootstrap | null;
  refreshBoot: () => Promise<void>;
  user: SessionUser | null;
  setUser: (u: SessionUser | null) => void;
  toasts: Toast[];
  toast: (msg: string, kind?: "ok" | "err") => void;
  consent: { statistics: boolean; marketing: boolean } | null;
  saveConsent: (c: { statistics: boolean; marketing: boolean }) => void;
  openCookiePrefs: boolean;
  setOpenCookiePrefs: (v: boolean) => void;
  myZone: string | null;
  setMyZone: (z: string | null) => void;
};

const AppCtx = createContext<Ctx | null>(null);

const ZONE_KEY = "zoomzoom.miaZona"; // preferenza tecnica non sensibile, non legata all'account

export function AppProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [consent, setConsent] = useState<{ statistics: boolean; marketing: boolean } | null>(null);
  const [openCookiePrefs, setOpenCookiePrefs] = useState(false);
  const [myZone, setMyZoneState] = useState<string | null>(null);
  const toastId = useRef(0);

  const refreshBoot = useCallback(async () => {
    const res = await api<Bootstrap>("/api/public/bootstrap");
    if (res.ok) setBoot(res);
  }, []);

  useEffect(() => { void refreshBoot(); }, [refreshBoot]);

  useEffect(() => {
    try {
      const saved = document.cookie.split("; ").find(c => c.startsWith("zz_consent="));
      if (saved) {
        const v = JSON.parse(decodeURIComponent(saved.split("=").slice(1).join("=")));
        setConsent({ statistics: !!v.statistics, marketing: !!v.marketing });
      }
      const z = localStorage.getItem(ZONE_KEY);
      if (z) setMyZoneState(z);
    } catch { /* preferenze non disponibili */ }
  }, []);

  const toast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4600);
  }, []);

  const saveConsent = useCallback((c: { statistics: boolean; marketing: boolean }) => {
    setConsent(c);
    // registro lato server (prove di consenso) + cookie tecnico leggibile per la UI
    document.cookie = `zz_consent=${encodeURIComponent(JSON.stringify({ ...c, v: 1, at: new Date().toISOString() }))}; path=/; max-age=${180 * 24 * 3600}; samesite=lax`;
    void api("/api/consent", { body: c });
  }, []);

  const setMyZone = useCallback((z: string | null) => {
    setMyZoneState(z);
    try {
      if (z) localStorage.setItem(ZONE_KEY, z);
      else localStorage.removeItem(ZONE_KEY);
    } catch { /* storage non disponibile */ }
  }, []);

  const setUser = useCallback((u: SessionUser | null) => {
    setBoot(b => (b ? { ...b, user: u } : b));
  }, []);

  const value = useMemo<Ctx>(() => ({
    boot, refreshBoot, user: boot?.user || null, setUser, toasts, toast,
    consent, saveConsent, openCookiePrefs, setOpenCookiePrefs, myZone, setMyZone,
  }), [boot, refreshBoot, setUser, toasts, toast, consent, saveConsent, openCookiePrefs, myZone, setMyZone]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp fuori dal provider");
  return ctx;
}
