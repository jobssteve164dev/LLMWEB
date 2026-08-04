"use client";

import { useEffect, useState } from "react";

type Mode = "login" | "register" | "forgot" | "reset" | "verify" | "check-email" | "verified";

export function AuthScreen({ initialMode = "login", onAuthenticated }: { initialMode?: Mode; onAuthenticated?: () => void }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [pendingAction, setPendingAction] = useState<"verification" | "reset">("verification");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(initialMode === "verify");

  useEffect(() => {
    if (initialMode !== "verify") return;
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      void Promise.resolve().then(() => {
        setError("验证链接不完整，请重新获取验证邮件。");
        setSubmitting(false);
      });
      return;
    }
    void authRequest(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, { method: "GET" })
      .then(() => { setMode("verified"); onAuthenticated?.(); })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "验证没有完成。"))
      .finally(() => setSubmitting(false));
  }, [initialMode, onAuthenticated]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      if (mode === "login") {
        await authRequest("/api/auth/login", jsonBody({ email: form.get("email"), password: form.get("password") }));
        onAuthenticated?.();
      } else if (mode === "register") {
        const nextEmail = String(form.get("email") || "");
        await authRequest("/api/auth/register", jsonBody({ name: form.get("name"), email: nextEmail, password: form.get("password") }));
        setEmail(nextEmail);
        setPendingAction("verification");
        setMode("check-email");
      } else if (mode === "forgot") {
        const nextEmail = String(form.get("email") || "");
        await authRequest("/api/auth/forgot-password", jsonBody({ email: nextEmail }));
        setEmail(nextEmail);
        setPendingAction("reset");
        setMode("check-email");
      } else if (mode === "reset") {
        const token = new URLSearchParams(window.location.search).get("token");
        await authRequest("/api/auth/reset-password", jsonBody({ token, password: form.get("password") }));
        window.location.assign("/workbench/project");
      }
    } catch (caught) {
      if (mode === "login" && caught instanceof AuthRequestError && caught.code === "email_verification_required") {
        setEmail(caught.email || String(form.get("email") || ""));
        setPendingAction("verification");
        setMode("check-email");
        return;
      }
      setError(caught instanceof Error ? caught.message : "操作没有完成。");
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
  };

  if (mode === "verify") return <AuthShell title="正在验证邮箱" description="验证完成后会直接打开你的工作台。">{submitting ? <p className="authStatus">请稍候…</p> : error ? <p className="loginError" role="alert">{error}</p> : null}</AuthShell>;
  if (mode === "verified") return <AuthShell title="邮箱已验证" description="你的账号已经可以使用。"><button className="primaryButton" type="button" onClick={() => window.location.assign("/workbench/project")}>进入工作台</button></AuthShell>;
  if (mode === "check-email") return <AuthShell title="请查看邮箱" description={email ? `我们已经向 ${email} 发送了下一步链接。` : "我们已经发送了下一步链接。"}><button className="primaryButton" type="button" onClick={() => switchMode("login")}>返回登录</button><button className="resendButton" disabled={submitting} type="button" onClick={async () => { setSubmitting(true); setError(""); try { await authRequest(pendingAction === "verification" ? "/api/auth/resend-verification" : "/api/auth/forgot-password", jsonBody({ email })); } catch (caught) { setError(caught instanceof Error ? caught.message : "没有发送成功。"); } finally { setSubmitting(false); } }}>{submitting ? "正在发送…" : pendingAction === "verification" ? "重新发送验证邮件" : "重新发送重置邮件"}</button>{error ? <p className="loginError" role="alert">{error}</p> : null}</AuthShell>;

  const isRegister = mode === "register";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";
  return <AuthShell
    title={isRegister ? "建立你的账号" : isForgot ? "找回密码" : isReset ? "设置新密码" : "打开训练工作台"}
    description={isRegister ? "注册后，每个项目的数据、训练和模型都彼此独立。" : isForgot ? "输入注册邮箱，我们会发送重置链接。" : isReset ? "设置一个至少 8 位的新密码。" : "使用邮箱登录，继续你的训练项目。"}
  >
    <form onSubmit={submit}>
      {isRegister ? <label><span>你的称呼</span><input type="text" name="name" autoComplete="name" maxLength={80} /></label> : null}
      {!isReset ? <label><span>邮箱</span><input type="email" name="email" autoComplete="email" required autoFocus /></label> : null}
      {!isForgot ? <label><span>{isReset ? "新密码" : "密码"}</span><input type="password" name="password" autoComplete={isRegister ? "new-password" : isReset ? "new-password" : "current-password"} minLength={8} required /></label> : null}
      {error ? <p className="loginError" role="alert">{error}</p> : null}
      <button className="primaryButton" disabled={submitting} type="submit">{submitting ? "请稍候…" : isRegister ? "注册并验证邮箱" : isForgot ? "发送重置链接" : isReset ? "保存新密码" : "进入工作台"}</button>
    </form>
    <div className="authSwitch">
      {mode === "login" ? <><button type="button" onClick={() => switchMode("register")}>注册账号</button><button type="button" onClick={() => switchMode("forgot")}>忘记密码</button></> : <button type="button" onClick={() => switchMode("login")}>返回登录</button>}
    </div>
  </AuthShell>;
}

function AuthShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <main className="loginScreen"><section><span className="brandMark" aria-hidden="true">L</span><p className="loginEyebrow">LLMWEB</p><h1>{title}</h1><p>{description}</p>{children}</section></main>;
}

function jsonBody(value: Record<string, unknown>): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) };
}

async function authRequest(path: string, options: RequestInit) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string; code?: string; email?: string } | null;
    throw new AuthRequestError(payload?.detail || "操作没有完成，请稍后再试。", payload?.code, payload?.email);
  }
  return response.json().catch(() => null);
}

class AuthRequestError extends Error {
  constructor(message: string, readonly code?: string, readonly email?: string) {
    super(message);
  }
}
