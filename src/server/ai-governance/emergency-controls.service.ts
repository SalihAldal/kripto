import { upsertEmergencyControl } from "@/src/server/ai-governance/ai-governance.repository";

const DEFAULT_CONTROLS = [
  { controlKey: "GLOBAL_KILL", name: "Global Kill Switch", scope: "GLOBAL" },
  { controlKey: "AI_KILL", name: "AI Kill Switch", scope: "AI" },
  { controlKey: "SCANNER_KILL", name: "Scanner Kill Switch", scope: "SCANNER" },
  { controlKey: "DECISION_ENGINE_KILL", name: "Decision Engine Kill Switch", scope: "DECISION_ENGINE" },
  { controlKey: "EXECUTION_KILL", name: "Execution Kill Switch", scope: "EXECUTION" },
  { controlKey: "PAPER_ONLY", name: "Paper Only Mode", scope: "EXECUTION" },
  { controlKey: "SHADOW_ONLY", name: "Shadow Only Mode", scope: "DEPLOYMENT" },
  { controlKey: "MAINTENANCE", name: "Maintenance Mode", scope: "GLOBAL" },
  { controlKey: "SAFE_MODE", name: "Safe Mode", scope: "GLOBAL" },
] as const;

export async function seedEmergencyControls() {
  for (const ctrl of DEFAULT_CONTROLS) {
    await upsertEmergencyControl({ controlKey: ctrl.controlKey, name: ctrl.name, enabled: false, scope: ctrl.scope });
  }
  return { seeded: DEFAULT_CONTROLS.length };
}

export async function activateEmergencyControl(input: {
  controlKey: string;
  enabled: boolean;
  reason?: string;
  actor?: string;
  environment?: string;
  exchange?: string;
  accountId?: string;
  tenantId?: string;
}) {
  const existing = DEFAULT_CONTROLS.find((c) => c.controlKey === input.controlKey);
  return upsertEmergencyControl({
    controlKey: input.controlKey,
    name: existing?.name ?? input.controlKey,
    enabled: input.enabled,
    scope: existing?.scope ?? "GLOBAL",
    reason: input.reason,
    actor: input.actor,
    environment: input.environment,
    exchange: input.exchange,
    accountId: input.accountId,
    tenantId: input.tenantId,
  });
}

export async function listEmergencyControls() {
  const { prisma } = await import("@/src/server/db/prisma");
  return prisma.emergencyControl.findMany({ orderBy: { controlKey: "asc" } });
}

export async function isEmergencyActive(controlKey: string) {
  const { prisma } = await import("@/src/server/db/prisma");
  const row = await prisma.emergencyControl.findUnique({ where: { controlKey } });
  return row?.enabled ?? false;
}
