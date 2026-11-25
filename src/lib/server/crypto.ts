// ZoomZoom — primitive crittografiche server-side.
// Nessuna password, token o segreto in chiaro nel database o nel client.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";

const APP_SECRET = process.env.APP_SECRET || "";

/** Hash password con scrypt (salt casuale per utente, parametri costosi). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const N = 16384, r = 8, p = 1, keylen = 64;
  const hash = scryptSync(password, salt, keylen, { N, r, p }).toString("hex");
  return `scrypt$${N}$${r}$${p}$${salt}$${hash}`;
}

/** Verifica password con confronto a tempo costante. */
export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, Ns, rs, ps, salt, hash] = parts;
  try {
    const calc = scryptSync(password, salt, Buffer.from(hash, "hex").length, {
      N: Number(Ns), r: Number(rs), p: Number(ps),
    }).toString("hex");
    return timingSafeEqual(Buffer.from(calc, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

/** Token casuale crittograficamente sicuro (hex, 256 bit di entropia). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** SHA-256 esadecimale — per token ad alta entropia (non per password). */
export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Confronto costante tra due stringhe esadecimali. */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex"), bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Cifra un segreto (es. TOTP) con AES-256-GCM usando APP_SECRET. */
export function encryptSecret(plain: string): string {
  if (!APP_SECRET) throw new Error("APP_SECRET non configurata");
  const key = createHash("sha256").update(APP_SECRET).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${enc.toString("hex")}`;
}

/** Decifra un segreto cifrato con encryptSecret. */
export function decryptSecret(payload: string): string {
  if (!APP_SECRET) throw new Error("APP_SECRET non configurata");
  const [ivH, tagH, dataH] = payload.split(".");
  const key = createHash("sha256").update(APP_SECRET).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivH, "hex"));
  decipher.setAuthTag(Buffer.from(tagH, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataH, "hex")), decipher.final()]).toString("utf8");
}
