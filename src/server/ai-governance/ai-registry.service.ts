import { prisma } from "@/src/server/db/prisma";
import { registerModel } from "@/src/server/ai-governance/ai-governance.repository";
import type { ModelRegistryType } from "@prisma/client";

const DEFAULT_REGISTRIES: Array<{ key: string; name: string; type: ModelRegistryType }> = [
  { key: "ai_model_primary", name: "Primary AI Model", type: "AI_MODEL" },
  { key: "scanner_main", name: "Main Scanner", type: "SCANNER" },
  { key: "strategy_production", name: "Production Strategy", type: "STRATEGY" },
  { key: "prompt_decision", name: "Decision Prompt", type: "PROMPT" },
  { key: "threshold_momentum", name: "Momentum Thresholds", type: "THRESHOLD" },
  { key: "risk_profile_default", name: "Default Risk Profile", type: "RISK_PROFILE" },
  { key: "portfolio_profile_default", name: "Default Portfolio Profile", type: "PORTFOLIO_PROFILE" },
  { key: "execution_profile_default", name: "Default Execution Profile", type: "EXECUTION_PROFILE" },
];

export async function seedDefaultRegistry() {
  const results = [];
  for (const item of DEFAULT_REGISTRIES) {
    results.push(await registerModel({ registryKey: item.key, name: item.name, registryType: item.type, actor: "system" }));
  }
  return { seeded: results.length };
}

export async function listRegistry(type?: ModelRegistryType, tenantId?: string) {
  return prisma.modelRegistry.findMany({
    where: { ...(type ? { registryType: type } : {}), ...(tenantId ? { tenantId } : {}), active: true },
    orderBy: { updatedAt: "desc" },
    include: { versions: { orderBy: { createdAt: "desc" }, take: 5 } },
  });
}

export async function getRegistryByKey(registryKey: string) {
  return prisma.modelRegistry.findUnique({
    where: { registryKey },
    include: { versions: { orderBy: { createdAt: "desc" } } },
  });
}
