// POST /api/admin/logout — chiusura sessione amministrativa.
import { NextResponse } from "next/server";
import { logout } from "@/lib/server/auth";
import { handleError } from "@/lib/server/http";

export async function POST() {
  try {
    await logout("admin");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
