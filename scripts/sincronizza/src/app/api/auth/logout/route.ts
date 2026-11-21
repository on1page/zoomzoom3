// POST /api/auth/logout — chiusura sessione pubblica.
import { NextResponse } from "next/server";
import { logout } from "@/lib/server/auth";
import { handleError } from "@/lib/server/http";

export async function POST() {
  try {
    await logout("public");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
