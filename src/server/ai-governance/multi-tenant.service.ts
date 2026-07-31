import { registerModel } from "@/src/server/ai-governance/ai-governance.repository";
import type { TenantContext } from "@/src/server/ai-governance/security.service";
import { buildTenantScope } from "@/src/server/ai-governance/security.service";
import type { ModelRegistryType } from "@prisma/client";

export async function registerTenantModel(input: {
  registryKey: string;
  name: string;
  registryType: ModelRegistryType;
  tenant: TenantContext;
  actor?: string;
}) {
  const scope = buildTenantScope(input.tenant);
  return registerModel({
    registryKey: `${input.tenant.tenantId ?? "default"}_${input.registryKey}`,
    name: input.name,
    registryType: input.registryType,
    tenantId: scope.tenantId ?? undefined,
    exchange: scope.exchange ?? undefined,
    accountId: scope.accountId ?? undefined,
    region: scope.region ?? undefined,
    fundId: scope.fundId ?? undefined,
    clientId: scope.clientId ?? undefined,
    metadata: { multiTenant: true, ...scope },
    actor: input.actor,
  });
}

export function getMultiTenantMetadata(ctx: TenantContext) {
  return {
    supportsMultipleModels: true,
    supportsMultipleStrategies: true,
    supportsMultipleExchanges: true,
    supportsMultipleRegions: true,
    supportsMultipleAccounts: true,
    supportsMultipleFunds: true,
    supportsMultipleClients: true,
    architecture: "multi-tenant-ready",
    scope: buildTenantScope(ctx),
  };
}
