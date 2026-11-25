// ZoomZoom — codice TOTP corrente per un account demo (SOLO da CLI, per test).
// Uso: bun scripts/totp.ts <email>
// Questo script esiste solo per collaudare il back office in ambiente demo:
// nessuna API lo espone e il front-end non mostra mai codici TOTP.
import { PrismaClient } from "@prisma/client";
import { createHmac, createHash, createDecipheriv } from "crypto";

const db = new PrismaClient();
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const ch of clean) {
    val = (val << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
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

function decryptSecret(payload: string): string {
  const APP_SECRET = process.env.APP_SECRET || "";
  if (!APP_SECRET) throw new Error("APP_SECRET mancante");
  const [ivH, tagH, dataH] = payload.split(".");
  const key = createHash("sha256").update(APP_SECRET).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivH, "hex"));
  decipher.setAuthTag(Buffer.from(tagH, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataH, "hex")), decipher.final()]).toString("utf8");
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.log("Uso: bun scripts/totp.ts <email>");
    process.exit(1);
  }
  const u = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!u || !u.totpSecretEnc) {
    console.log("Account non trovato o senza 2FA.");
    process.exit(1);
  }
  const secret = decryptSecret(u.totpSecretEnc);
  const code = totpCode(secret, Math.floor(Date.now() / 1000 / 30));
  console.log(`Codice TOTP attuale per ${u.email}: ${code} (valido ~30 secondi)`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
