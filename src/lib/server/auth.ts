// ZoomZoom — autenticazione e autorizzazione server-side.
// Sessioni in cookie httpOnly; token di sessione conservati solo come hash;
// ruoli e permessi applicati QUI (e in ogni API route), mai nel client.
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "./crypto";
import { securityLog } from "./audit";
import { getSettings } from "./settings";
import type { TotpEnrollment } from "./qr";

export type { TotpEnrollment };

export type Role = "user" | "moderator" | "admin" | "superadmin";
export const ROLE_LABELS: Record<Role, string> = {
  user: "Utente", moderator: "Moderatore", admin: "Amministratore", superadmin: "Super amministratore",
};

export const PERMS: Record<Role, string[]> = {
  user: [],
  moderator: ["mod.reports", "mod.reviews", "mod.experiences", "mod.disputes", "audit.own"],
  admin: ["mod.reports", "mod.reviews", "mod.experiences", "mod.disputes", "audit.own", "audit.full",
    "admin.users", "admin.entities", "admin.invites", "admin.contents", "admin.settings", "admin.security"],
  superadmin: ["mod.reports", "mod.reviews", "mod.experiences", "mod.disputes", "audit.own", "audit.full",
    "admin.users", "admin.entities", "admin.invites", "admin.contents", "admin.settings", "admin.security",
    "admin.roles", "admin.demo"],
};

export function hasPerm(role: string, perm: string): boolean {
  return (PERMS[role as Role] || []).includes(perm);
}

export const PUBLIC_TTL_MS = 7 * 24 * 3600 * 1000;
export const ADMIN_TTL_MS = 30 * 60 * 1000; // 30 minuti di inattività
export const PUBLIC_COOKIE = "zz_session";
export const ADMIN_COOKIE = "zz_admin_session";
export const VISITOR_COOKIE = "zz_visitor";

export type SessionUser = {
  id: string; email: string; nickname: string; role: Role;
  emailVerified: boolean; subjectEntityId: string | null;
  totpEnabled: boolean; disabled: boolean; isDemo: boolean; createdAt: Date;
};

function toSessionUser(u: {
  id: string; email: string; nickname: string; role: string; emailVerified: boolean;
  subjectEntityId: string | null; totpEnabled: boolean; disabled: boolean; isDemo: boolean; createdAt: Date;
}): SessionUser {
  return {
    id: u.id, email: u.email, nickname: u.nickname, role: u.role as Role,
    emailVerified: u.emailVerified, subjectEntityId: u.subjectEntityId,
    totpEnabled: u.totpEnabled, disabled: u.disabled, isDemo: u.isDemo, createdAt: u.createdAt,
  };
}

async function createSession(userId: string, kind: "public" | "admin"): Promise<string> {
  const token = randomToken(32);
  const ttl = kind === "admin" ? ADMIN_TTL_MS : PUBLIC_TTL_MS;
  await db.session.create({
    data: { userId, kind, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttl) },
  });
  const jar = await cookies();
  jar.set(kind === "admin" ? ADMIN_COOKIE : PUBLIC_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(ttl / 1000),
  });
  return token;
}

async function readSession(kind: "public" | "admin"): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(kind === "admin" ? ADMIN_COOKIE : PUBLIC_COOKIE)?.value;
  if (!token) return null;
  const hash = sha256(token);
  const session = await db.session.findUnique({ where: { tokenHash: hash }, include: { user: true } });
  if (!session || session.kind !== kind) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() < now) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.user.disabled) return null;
  if (kind === "admin") {
    const staffRole = session.user.role as Role;
    if (!["moderator", "admin", "superadmin"].includes(staffRole)) return null;
    // finestra di inattività ravvivata a ogni uso
    await db.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(now + ADMIN_TTL_MS) },
    }).catch(() => {});
  }
  return toSessionUser(session.user);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  return readSession("public");
}

export async function getCurrentAdmin(): Promise<SessionUser | null> {
  return readSession("admin");
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) throw new AuthError("AUTH_REQUIRED", 401);
  return u;
}

export async function requireStaff(perm?: string): Promise<SessionUser> {
  const u = await getCurrentAdmin();
  if (!u) throw new AuthError("ADMIN_REQUIRED", 401);
  if (perm && !hasPerm(u.role, perm)) throw new AuthError("FORBIDDEN", 403);
  return u;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

/* ---------- Login area pubblica ---------- */

export type LoginResult =
  | { ok: true }
  | { needs2fa: true; enrollment?: TotpEnrollment }
  | { error: "invalid" | "locked" | "disabled" | "staffOnly" };

/** QR di prima configurazione 2FA: costruito SOLO dopo verifica della password
 *  e SOLO se l'utente non ha mai completato un accesso con codice (bootstrap). */
async function firstLoginEnrollment(email: string, totpSecretEnc: string, area: "pubblica" | "amministrativa", isDemo: boolean): Promise<TotpEnrollment> {
  const { decryptTotpSecret } = await import("./totp");
  const { totpEnrollment } = await import("./qr");
  const settings = await getSettings();
  const secret = decryptTotpSecret(totpSecretEnc);
  const enrollment = await totpEnrollment(secret, email, settings.siteName);
  // tracciatura senza mai loggare il segreto
  await securityLog("totp_enroll_qr_shown", "info", `QR di prima configurazione 2FA mostrato sull'area ${area} a ${email} (password già verificata).`, isDemo);
  return enrollment;
}

export async function publicLogin(email: string, password: string, clientIp: string): Promise<LoginResult> {
  const em = String(email || "").trim().toLowerCase();
  const u = await db.user.findUnique({ where: { email: em } });
  const isDemo = process.env.DEMO_MODE === "true";
  if (u && u.lockedUntil && u.lockedUntil.getTime() > Date.now()) return { error: "locked" };
  // hashing fittizio per uniformare i tempi quando l'utente non esiste
  const storedHash = u?.passwordHash ?? null;
  const ok = storedHash
    ? (await import("./crypto")).verifyPassword(String(password || ""), storedHash)
    : false;
  if (!u || !ok) {
    if (u) {
      const failed = u.failedLogins + 1;
      const lock = failed >= 5;
      await db.user.update({
        where: { id: u.id },
        data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + 60_000) : null },
      });
      if (lock) {
        await securityLog("login_failed_repeat", "warn", `5 tentativi di accesso falliti per ${u.email} — blocco temporaneo di 60 s applicato.`, isDemo);
      }
    } else {
      // timing mitigate: esegue comunque uno scrypt su un hash di comodo
      (await import("./crypto")).verifyPassword(String(password || ""), "scrypt$16384$8$1$00$00");
    }
    return { error: "invalid" };
  }
  if (u.disabled) return { error: "disabled" };
  if (["moderator", "admin", "superadmin"].includes(u.role)) return { error: "staffOnly" };
  await db.user.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null } });
  if (u.totpEnabled) {
    // primo accesso 2FA mai completato: una sola volta, dopo la verifica
    // della password, il passo 2FA include il QR per registrare l'app
    if (!u.firstTotpLoginAt && u.totpSecretEnc) {
      return { needs2fa: true, enrollment: await firstLoginEnrollment(u.email, u.totpSecretEnc, "pubblica", isDemo) };
    }
    return { needs2fa: true };
  }
  await createSession(u.id, "public");
  return { ok: true };
}

export async function publicLoginSecondFactor(email: string, password: string, code: string): Promise<LoginResult> {
  const em = String(email || "").trim().toLowerCase();
  const u = await db.user.findUnique({ where: { email: em } });
  if (!u || !u.totpEnabled || !u.totpSecretEnc || u.disabled) return { error: "invalid" };
  const storedHash = u.passwordHash;
  if (!storedHash || !(await import("./crypto")).verifyPassword(String(password || ""), storedHash)) {
    return { error: "invalid" };
  }
  if (["moderator", "admin", "superadmin"].includes(u.role)) return { error: "staffOnly" };
  const { verifyTotp, decryptTotpSecret } = await import("./totp");
  if (!verifyTotp(decryptTotpSecret(u.totpSecretEnc), String(code || ""))) {
    await securityLog("totp_failed", "warn", `Codice 2FA errato per ${u.email}.`, process.env.DEMO_MODE === "true");
    return { error: "invalid" };
  }
  // primo accesso 2FA riuscito: da qui in poi il QR non viene più mostrato
  await db.user.update({
    where: { id: u.id },
    data: { failedLogins: 0, lockedUntil: null, ...(u.firstTotpLoginAt ? {} : { firstTotpLoginAt: new Date() }) },
  });
  await createSession(u.id, "public");
  return { ok: true };
}

/* ---------- Login area amministrativa: password + TOTP obbligatori ---------- */

export async function adminLogin(email: string, password: string, code: string): Promise<{ ok: boolean; error?: string; enrollment?: TotpEnrollment }> {
  const em = String(email || "").trim().toLowerCase();
  const isDemo = process.env.DEMO_MODE === "true";
  const u = await db.user.findUnique({ where: { email: em } });
  if (u && u.lockedUntil && u.lockedUntil.getTime() > Date.now()) return { ok: false, error: "locked" };
  const storedHash = u?.passwordHash ?? null;
  const pwOk = storedHash
    ? (await import("./crypto")).verifyPassword(String(password || ""), storedHash)
    : false;
  if (!u || !pwOk) {
    if (u) {
      const failed = u.failedLogins + 1;
      const lock = failed >= 5;
      await db.user.update({
        where: { id: u.id },
        data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + 60_000) : null },
      });
      if (lock) await securityLog("login_failed_repeat", "warn", `5 tentativi falliti sull'area amministrativa per ${u.email}.`, isDemo);
    } else {
      (await import("./crypto")).verifyPassword(String(password || ""), "scrypt$16384$8$1$00$00");
      await securityLog("admin_login_failed", "warn", "Credenziali non valide sull'area amministrativa.", isDemo);
    }
    return { ok: false, error: "invalid" };
  }
  if (u.disabled) return { ok: false, error: "disabled" };
  if (!["moderator", "admin", "superadmin"].includes(u.role)) return { ok: false, error: "notStaff" };
  // 2FA obbligatoria per lo staff
  if (!u.totpEnabled || !u.totpSecretEnc) return { ok: false, error: "totpMissing" };
  const codeClean = String(code || "").replace(/\s/g, "");
  const { verifyTotp, decryptTotpSecret } = await import("./totp");
  if (!verifyTotp(decryptTotpSecret(u.totpSecretEnc), codeClean)) {
    // primo accesso 2FA mai completato (es. account demo o migrazioni):
    // la password è già verificata, quindi si può mostrare UNA sola volta
    // il QR per registrare l'app, senza contarlo come tentativo fallito
    if (!u.firstTotpLoginAt) {
      return { ok: false, error: codeClean ? "totp" : "totpEmpty", enrollment: await firstLoginEnrollment(u.email, u.totpSecretEnc, "amministrativa", isDemo) };
    }
    await securityLog("admin_login_failed", "warn", `Accesso amministrativo negato (credenziali o 2FA non validi) per ${u.email}.`, isDemo);
    return { ok: false, error: codeClean ? "totp" : "totpEmpty" };
  }
  // primo accesso 2FA riuscito: da qui in poi il QR non viene più mostrato
  await db.user.update({
    where: { id: u.id },
    data: { failedLogins: 0, lockedUntil: null, ...(u.firstTotpLoginAt ? {} : { firstTotpLoginAt: new Date() }) },
  });
  await createSession(u.id, "admin");
  await securityLog("admin_login_ok", "info", `Accesso all'area amministrativa riuscito con 2FA (${u.email}).`, isDemo);
  return { ok: true };
}

export async function logout(kind: "public" | "admin") {
  const jar = await cookies();
  const name = kind === "admin" ? ADMIN_COOKIE : PUBLIC_COOKIE;
  const token = jar.get(name)?.value;
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: sha256(token), kind } }).catch(() => {});
  }
  jar.delete(name);
}

/** Cookie visitatore tecnico per il registro dei consensi cookie (senza dati personali). */
export async function ensureVisitorId(): Promise<string> {
  const jar = await cookies();
  let v = jar.get(VISITOR_COOKIE)?.value;
  if (!v || !/^[a-f0-9]{32}$/.test(v)) {
    v = randomToken(16);
    jar.set(VISITOR_COOKIE, v, {
      httpOnly: false, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 400 * 24 * 3600,
    });
  }
  return v;
}
