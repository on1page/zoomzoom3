// GET /api/auth/google/start — avvio OAuth 2.0 Google (solo se configurato).
// Con state anti-CSRF conservato in cookie httpOnly breve.
import { NextRequest, NextResponse } from "next/server";
import { randomToken } from "@/lib/server/crypto";
import { cookies } from "next/headers";

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({
      ok: false,
      error: "Accesso con Google non configurato su questo server: imposta GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.",
    }, { status: 503 });
  }
  const origin = process.env.APP_BASE_URL || req.nextUrl.origin;
  const state = randomToken(16);
  const jar = await cookies();
  jar.set("zz_oauth_state", state, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 600,
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${origin}/api/auth/google/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return NextResponse.redirect(url.toString());
}
