// Utility per i documenti di verifica (hash del contenuto, nomi interni).
import { createHash, randomBytes } from "crypto";

export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

export function createHashOf(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
