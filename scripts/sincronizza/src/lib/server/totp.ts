// ZoomZoom — TOTP RFC 6238 server-side (HMAC-SHA1: standard TOTP, non per password).
// Il segreto è cifrato a riposo (AES-256-GCM) e mai inviato al client dopo l'attivazione.
import { createHmac, randomBytes } from "crypto";
import { decryptSecret, encryptSecret } from "./crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20)); // 160 bit, RFC 4226
}

function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const ch of clean) {
    val = (val << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function base32Encode(bytes: Buffer): string {
  let bits = 0, val = 0, out = "";
  for (const b of bytes) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

function totpCode(secretB32: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const off = mac[19] & 0x0f;
  const code = (((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3]) >>> 0;
  return String(code % 1_000_000).padStart(6, "0");
}

/** Verifica un codice TOTP con tolleranza ±1 periodo (30 s). */
export function verifyTotp(secretB32: string, code: string): boolean {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const t = Math.floor(Date.now() / 1000);
  for (const off of [-1, 0, 1]) {
    if (totpCode(secretB32, Math.floor(t / 30) + off) === c) return true;
  }
  return false;
}

/** Codice corrente (usato SOLO dallo script CLI di test, mai dalle API). */
export function currentTotp(secretB32: string): string {
  return totpCode(secretB32, Math.floor(Date.now() / 1000 / 30));
}

export function encryptTotpSecret(secret: string): string {
  return encryptSecret(secret);
}

export function decryptTotpSecret(payload: string): string {
  return decryptSecret(payload);
}

/** URI otpauth per le app di autenticazione. */
export function otpauthUri(secret: string, email: string, issuer: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
