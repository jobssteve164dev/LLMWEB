import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl, getLlmwebPlanTruth, getPassportClient, passportProduct } from "../../../lib/passport";
import { readSession, sessionCookie } from "../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = readSession(request.cookies.get(sessionCookie)?.value);
  if (!user) return NextResponse.redirect(new URL("/workbench/project", request.url));
  try {
    const plan = await getLlmwebPlanTruth();
    const result = await getPassportClient().createCheckoutLink({
      product: passportProduct,
      planId: plan.planId,
      email: user.email,
      userId: user.id,
      successUrl: `${appBaseUrl()}/workbench/project?checkout=success`,
      cancelUrl: `${appBaseUrl()}/?checkout=cancel`,
      metadata: plan.catalogVersion ? { catalogVersion: plan.catalogVersion } : undefined,
    }) as { url?: unknown; checkoutUrl?: unknown };
    const target = typeof result.url === "string" ? result.url : typeof result.checkoutUrl === "string" ? result.checkoutUrl : "";
    if (!target.startsWith("https://")) throw new Error("Passport checkout URL is unavailable");
    return NextResponse.redirect(target);
  } catch (error) {
    console.error("[LLMWEB] Passport checkout unavailable", error);
    return NextResponse.json({ detail: "当前无法开始升级，请稍后重试。" }, { status: 503 });
  }
}
