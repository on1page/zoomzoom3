// ZoomZoom — rate limiting in-memory per IP+azione.
// Limitazione dichiarata: in un'architettura multi-istanza questo stato va
// spostato su un negozio condiviso (es. Redis). In questo ambiente a istanza
// singola è sufficiente e non memorizza dati personali, solo contatori.
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export type RateResult = { ok: boolean; retryAfterSec: number };

export function rateLimit(key: string, limit: number, windowSec: number): RateResult {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { ok: true, retryAfterSec: 0 };
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/** Pulizia periodica dei bucket scaduti (chiamata pigra). */
export function sweepRateLimits() {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k);
}

/** IP del richiedente (dietro gateway) — solo per contatori, mai nei log. */
export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "local";
}
