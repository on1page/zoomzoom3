// GET /api/auth/me — dati della sessione pubblica corrente.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { handleError } from "@/lib/server/http";

export async function GET() {
  try {
    const user = await getCurrentUser();
    return NextResponse.json({
      ok: true,
      user: user ? {
        id: user.id, email: user.email, nickname: user.nickname, role: user.role,
        emailVerified: user.emailVerified, subjectEntityId: user.subjectEntityId,
        totpEnabled: user.totpEnabled, isDemo: user.isDemo, createdAt: user.createdAt.toISOString(),
        premium: {
          active: !!(user.premiumUntil && user.premiumUntil.getTime() > Date.now()),
          until: user.premiumUntil && user.premiumUntil.getTime() > Date.now() ? user.premiumUntil.toISOString() : null,
        },
      } : null,
    });
  } catch (e) {
    return handleError(e);
  }
}
