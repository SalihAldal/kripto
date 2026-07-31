import { prisma } from "@/src/server/db/prisma";
import { upsertFeatureFlag } from "@/src/server/ai-governance/ai-governance.repository";
import { emitAiGovernanceEvent, GOVERNANCE_EVENT } from "@/src/server/ai-governance/ai-governance.events";
import type { FeatureFlagStatus } from "@prisma/client";

export async function setFeatureFlag(input: {
  flagKey: string;
  name: string;
  status: FeatureFlagStatus;
  rolloutPct?: number;
  environment?: string;
  exchange?: string;
  accountId?: string;
  tenantId?: string;
  abVariant?: string;
  actor?: string;
}) {
  const row = await upsertFeatureFlag(input);
  emitAiGovernanceEvent(
    input.status === "ENABLED" || input.status === "PARTIAL" ? GOVERNANCE_EVENT.FEATURE_ENABLED : GOVERNANCE_EVENT.FEATURE_DISABLED,
    { flagKey: input.flagKey, status: input.status, rolloutPct: input.rolloutPct },
  );
  return row;
}

export async function listFeatureFlags(environment = "production") {
  return prisma.featureFlag.findMany({ where: { environment }, orderBy: { updatedAt: "desc" } });
}

export async function isFeatureEnabled(flagKey: string, context?: { environment?: string; exchange?: string; accountId?: string; tenantId?: string; hash?: number }) {
  const row = await prisma.featureFlag.findFirst({
    where: {
      flagKey,
      environment: context?.environment ?? "production",
      exchange: context?.exchange ?? "",
      accountId: context?.accountId ?? "",
      tenantId: context?.tenantId ?? "",
    },
  });
  if (!row || row.status === "DISABLED" || row.status === "ROLLBACK") return false;
  if (row.status === "ENABLED") return true;
  if (row.status === "PARTIAL" && row.rolloutPct > 0) {
    const bucket = (context?.hash ?? Math.random() * 100);
    return bucket <= row.rolloutPct;
  }
  return false;
}

export async function rollbackFeatureFlag(flagKey: string, actor?: string) {
  return setFeatureFlag({ flagKey, name: flagKey, status: "ROLLBACK", rolloutPct: 0, actor });
}
