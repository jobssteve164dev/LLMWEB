import { NextRequest, NextResponse } from "next/server";
import { sessionCookie, sessionValue, validAccount, validPassword } from "../../lib/session";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { account?: string; password?: string } | null;
  if (!body?.account || !body.password || !validAccount(body.account) || !validPassword(body.password)) {
    return NextResponse.json({ detail: "账户或密码不正确。" }, { status: 401 });
  }
  const response = NextResponse.json({ status: "authenticated" });
  response.cookies.set(sessionCookie, sessionValue(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ status: "signed_out" });
  response.cookies.set(sessionCookie, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
