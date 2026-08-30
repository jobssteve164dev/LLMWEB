import { createPassportClient, type PassportAccessDecision } from "@szlk/passport-client";

declare const client: ReturnType<typeof createPassportClient>;

async function verifyAccessDecisionType() {
  const decision: PassportAccessDecision = await client.checkAccess({
    product: "llmweb",
    featureKey: "project_limit_10",
  });
  decision.allowed satisfies boolean;
  decision.productAccess satisfies Record<string, unknown> | null;
  decision.featureGrant satisfies Record<string, unknown> | null;
  // @ts-expect-error access-check intentionally does not return an entitlement collection
  void decision.entitlements;
}

void verifyAccessDecisionType;
