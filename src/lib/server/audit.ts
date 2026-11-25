// ZoomZoom — registri di audit (moderazione) e sicurezza.
// Nessun segreto, password, token o contenuto di documenti nei log.
import { db } from "@/lib/db";

export async function auditLog(opts: {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  isDemo?: boolean;
}) {
  await db.auditLog.create({
    data: {
      actorId: opts.actorId ?? null,
      actorRole: opts.actorRole ?? null,
      action: opts.action,
      targetType: opts.targetType,
      targetId: opts.targetId ?? null,
      reason: opts.reason ?? null,
      isDemo: opts.isDemo ?? false,
    },
  });
}

export async function securityLog(type: string, severity: "info" | "warn" | "error", details: string, isDemo = false) {
  await db.securityLog.create({ data: { type, severity, details, isDemo } });
}
