// POST /api/me/nickname — modifica pseudonimo pubblico.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { guard, readJson, handleError, fail } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    guard(req, "nickname", 10, 3600);
    const { nickname } = await readJson<{ nickname?: string }>(req);
    const nick = String(nickname || "").trim();
    if (nick.length < 3) return fail("Almeno 3 caratteri.");
    if (/[\u0000-\u001f<>]/.test(nick)) return fail("Caratteri non ammessi.");
    const clash = await db.user.findFirst({ where: { nickname: nick, NOT: { id: user.id } } });
    if (clash) return fail("Questo pseudonimo è già in uso: scegline un altro.");
    await db.user.update({ where: { id: user.id }, data: { nickname: nick } });
    return NextResponse.json({ ok: true, nickname: nick });
  } catch (e) {
    return handleError(e);
  }
}
