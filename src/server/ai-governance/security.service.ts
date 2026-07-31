import type { ApprovalType } from "@prisma/client";

const DEPLOYMENT_ROLES = ["ADMIN", "GOVERNANCE"] as const;
const APPROVAL_ROLES: Record<ApprovalType, string[]> = {
  RESEARCH: ["ADMIN", "TRADER"],
  REPLAY: ["ADMIN", "TRADER"],
  RISK: ["ADMIN", "RISK"],
  PERFORMANCE: ["ADMIN", "TRADER"],
  GOVERNANCE: ["ADMIN", "GOVERNANCE"],
  MANUAL: ["ADMIN"],
};

export function canDeploy(roles: string[]) {
  return roles.some((r) => DEPLOYMENT_ROLES.includes(r as (typeof DEPLOYMENT_ROLES)[number]));
}

export function canApproveType(approvalType: ApprovalType, roles: string[]) {
  if (roles.includes("ADMIN")) return true;
  return roles.some((r) => APPROVAL_ROLES[approvalType]?.includes(r));
}

export function validateConfigurationIntegrity(config: Record<string, unknown>) {
  const issues: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || value === null) issues.push(`Null value: ${key}`);
    if (typeof value === "number" && !Number.isFinite(value)) issues.push(`Non-finite: ${key}`);
  }
  return { valid: issues.length === 0, issues };
}

export type TenantContext = {
  tenantId?: string;
  exchange?: string;
  accountId?: string;
  region?: string;
  fundId?: string;
  clientId?: string;
};

export function buildTenantScope(ctx: TenantContext) {
  return {
    tenantId: ctx.tenantId ?? null,
    exchange: ctx.exchange ?? null,
    accountId: ctx.accountId ?? null,
    region: ctx.region ?? null,
    fundId: ctx.fundId ?? null,
    clientId: ctx.clientId ?? null,
  };
}
