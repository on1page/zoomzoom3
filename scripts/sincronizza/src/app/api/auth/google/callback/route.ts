// GET /api/auth/google/callback — completamento OAuth Google.
// Verifica state, scambia il codice, collega/crea l'account con email verificata.
// Nota: l'email verificata da Google attesta il possesso dell'indirizzo, non
// l'unicità della persona (dichiarato nelle informative).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/server/crypto";
import { securityLog } from "@/lib/server/audit";
import { cookies } from "next/headers";

export async function GET(req: NextRequest) {
  const failRedirect = (msg: string) => NextResponse.redirect(
    new URL(`/#/accedi?errore=${encodeURIComponent(msg)}`, process.env.APP_BASE_URL || req.nextUrl.origin)
  );
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return failRedirect("Accesso Google non configurato.");
    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    const jar = await cookies();
    const savedState = jar.get("zz_oauth_state")?.value;
    jar.delete("zz_oauth_state");
    if (!code || !state || !savedState || state !== savedState) {
      return failRedirect("Verifica di sicurezza non superata: riprova.");
    }
    const origin = process.env.APP_BASE_URL || req.nextUrl.origin;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: `${origin}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return failRedirect("Google non ha accettato la richiesta: riprova.");
    const tokens = (await tokenRes.json()) as { access_token?: string };
    const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!infoRes.ok) return failRedirect("Non è stato possibile leggere il profilo Google.");
    const info = (await infoRes.json()) as { sub: string; email?: string; email_verified?: boolean; name?: string };
    if (!info.email || !info.email_verified) return failRedirect("L'account Google non espone un'email verificata.");

    const em = info.email.toLowerCase();
    let u = await db.user.findUnique({ where: { email: em } });
    if (!u) {
      const nicknameBase = (info.name || em.split("@")[0]).slice(0, 24);
      let nickname = nicknameBase;
      let i = 1;
      while (await db.user.findFirst({ where: { nickname } })) nickname = `${nicknameBase}_${i++}`;
      u = await db.user.create({
        data: {
          email: em, nickname, role: "user", emailVerified: true,
          googleSub: info.sub, isDemo: false,
        },
      });
      await securityLog("account_created_google", "info", `Nuova registrazione via Google: ${em}`);
    } else {
      if (u.disabled) return failRedirect("Account sospeso: contatta la moderazione.");
      if (["moderator", "admin", "superadmin"].includes(u.role)) {
        return failRedirect("Gli account di back office accedono solo dall'area dedicata con 2FA.");
      }
      await db.user.update({ where: { id: u.id }, data: { googleSub: info.sub, emailVerified: true } });
    }

    const token = randomToken(32);
    await db.session.create({
      data: { userId: u.id, kind: "public", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
    });
    jar.set("zz_session", token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 7 * 24 * 3600,
    });
    return NextResponse.redirect(new URL("/#/profilo", origin));
  } catch {
    return failRedirect("Errore durante l'accesso con Google: riprova.");
  }
}
