import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl, getPassportClient, linkPassportIdentity, PassportClientError } from "../../../lib/passport";
import { createSessionValue, sessionCookie, sessionMaxAge, type SessionUser } from "../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ action: string }> };

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readUser(result: Record<string, unknown>): SessionUser {
  const value = result.user;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Passport returned an invalid user");
  }
  const user = value as Record<string, unknown>;
  if (typeof user.id !== "string" || typeof user.email !== "string") {
    throw new Error("Passport returned an incomplete user");
  }
  return {
    id: user.id,
    email: user.email.trim().toLowerCase(),
    name: typeof user.name === "string" && user.name.trim() ? user.name.trim() : null,
  };
}

async function authenticatedResponse(user: SessionUser) {
  try {
    await linkPassportIdentity(user);
  } catch (error) {
    console.error("[LLMWEB] Passport identity link failed", error);
  }
  const response = NextResponse.json({ ok: true, user });
  response.cookies.set(sessionCookie, createSessionValue(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAge,
  });
  return response;
}

function authError(error: unknown) {
  if (error instanceof PassportClientError) {
    if (error.code === "auth_invalid_credentials" || error.code === "auth_user_not_found") {
      return NextResponse.json({ detail: "邮箱或密码不正确。" }, { status: 401 });
    }
    if (error.code === "auth_email_exists" || error.status === 409) {
      return NextResponse.json({ detail: "这个邮箱已经注册，请直接登录。" }, { status: 409 });
    }
    if (error.code === "auth_rate_limited" || error.status === 429) {
      return NextResponse.json({ detail: "尝试次数过多，请稍后再试。" }, { status: 429 });
    }
    if (error.code === "auth_invalid_token" || error.status === 400) {
      return NextResponse.json({ detail: "链接无效或已经过期，请重新获取。" }, { status: 400 });
    }
    console.error("[LLMWEB] Passport auth request failed", error);
    return NextResponse.json({ detail: "账号服务暂时不可用，请稍后再试。" }, { status: 503 });
  }
  console.error("[LLMWEB] Auth request failed", error);
  return NextResponse.json({ detail: "操作没有完成，请稍后再试。" }, { status: 500 });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { action } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ detail: "请求内容无效。" }, { status: 400 });

  try {
    const passport = getPassportClient();
    if (action === "login") {
      const email = normalizeEmail(body.email);
      const password = typeof body.password === "string" ? body.password : "";
      if (!email || !password) return NextResponse.json({ detail: "请填写邮箱和密码。" }, { status: 400 });
      const result = await passport.loginWithPassword({ email, password }) as Record<string, unknown>;
      const user = readUser(result);
      if (result.needsEmailVerification === true) {
        return NextResponse.json({ detail: "请先完成邮箱验证，再回来登录。", code: "email_verification_required", email }, { status: 409 });
      }
      return authenticatedResponse(user);
    }

    if (action === "register") {
      const email = normalizeEmail(body.email);
      const password = typeof body.password === "string" ? body.password : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!email || !password) return NextResponse.json({ detail: "请填写邮箱和密码。" }, { status: 400 });
      if (password.length < 8) return NextResponse.json({ detail: "密码至少需要 8 位。" }, { status: 400 });
      const result = await passport.registerWithPassword({ email, password, name: name || null, appBaseUrl: appBaseUrl() }) as Record<string, unknown>;
      return NextResponse.json({ ok: true, needsEmailVerification: result.needsEmailVerification === true, email });
    }

    if (action === "resend-verification") {
      const email = normalizeEmail(body.email);
      if (!email) return NextResponse.json({ detail: "请填写邮箱。" }, { status: 400 });
      await passport.resendVerification({ email, appBaseUrl: appBaseUrl() });
      return NextResponse.json({ ok: true });
    }

    if (action === "forgot-password") {
      const email = normalizeEmail(body.email);
      if (!email) return NextResponse.json({ detail: "请填写邮箱。" }, { status: 400 });
      await passport.forgotPassword({ email, appBaseUrl: appBaseUrl() });
      return NextResponse.json({ ok: true });
    }

    if (action === "reset-password") {
      const token = typeof body.token === "string" ? body.token.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!token || password.length < 8) return NextResponse.json({ detail: "请使用有效链接，并设置至少 8 位的新密码。" }, { status: 400 });
      const result = await passport.resetPassword({ token, password }) as Record<string, unknown>;
      return authenticatedResponse(readUser(result));
    }

    return NextResponse.json({ detail: "认证操作不存在。" }, { status: 404 });
  } catch (error) {
    return authError(error);
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { action } = await context.params;
  if (action !== "verify-email") return NextResponse.json({ detail: "认证操作不存在。" }, { status: 404 });
  const token = request.nextUrl.searchParams.get("token")?.trim();
  if (!token) return NextResponse.json({ detail: "验证链接不完整。" }, { status: 400 });
  try {
    const result = await getPassportClient().verifyEmailToken({ token }) as Record<string, unknown>;
    return authenticatedResponse(readUser(result));
  } catch (error) {
    return authError(error);
  }
}
