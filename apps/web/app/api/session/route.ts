import { NextRequest, NextResponse } from "next/server";
import { projectLimitForUser } from "../../lib/passport";
import { readSession, sessionCookie } from "../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = readSession(request.cookies.get(sessionCookie)?.value);
  if (!user) return NextResponse.json({ detail: "请先登录。" }, { status: 401 });
  const projectLimit = await projectLimitForUser(user);
  return NextResponse.json({ user, tier: projectLimit === 10 ? "paid" : "free", projectLimit });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
