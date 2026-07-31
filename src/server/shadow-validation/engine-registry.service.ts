import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import { DEFAULT_SHADOW_ENGINES, type ShadowEngineDefinition } from "@/src/server/shadow-validation/shadow-validation.types";

export async function ensureShadowEngineRegistrySeeded() {
  for (const engine of DEFAULT_SHADOW_ENGINES) {
    await prisma.shadowEngineRegistry.upsert({
      where: { engineId: engine.engineId },
      create: {
        engineId: engine.engineId,
        name: engine.name,
        version: engine.version,
        mode: engine.mode,
        enabled: engine.enabled,
        trafficPct: engine.trafficPct,
        adapter: engine.adapter,
        metadata: engine.metadata as Prisma.InputJsonValue,
      },
      update: {
        name: engine.name,
        version: engine.version,
        mode: engine.mode,
        enabled: engine.enabled,
        trafficPct: engine.trafficPct,
        adapter: engine.adapter,
        metadata: engine.metadata as Prisma.InputJsonValue,
      },
    });
  }
}

export async function listActiveShadowEngines(): Promise<ShadowEngineDefinition[]> {
  await ensureShadowEngineRegistrySeeded();
  const rows = await prisma.shadowEngineRegistry.findMany({
    where: { enabled: true },
    orderBy: { engineId: "asc" },
  });
  return rows.map((row) => ({
    engineId: row.engineId,
    name: row.name,
    version: row.version,
    mode: row.mode,
    enabled: row.enabled,
    trafficPct: row.trafficPct,
    adapter: row.adapter as ShadowEngineDefinition["adapter"],
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
  }));
}

export async function getProductionEngine() {
  await ensureShadowEngineRegistrySeeded();
  return prisma.shadowEngineRegistry.findFirst({
    where: { mode: "PRODUCTION", enabled: true },
  });
}

export async function listShadowOnlyEngines() {
  const engines = await listActiveShadowEngines();
  return engines.filter((row) => row.mode === "SHADOW" || row.mode === "SIMULATION");
}

export function shouldRunEngineForTraffic(engine: ShadowEngineDefinition, decisionId: string) {
  if (engine.mode === "PRODUCTION") return true;
  if (engine.trafficPct >= 100) return true;
  if (engine.trafficPct <= 0) return false;
  const hash = decisionId.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return hash % 100 < engine.trafficPct;
}

export async function shouldRunEngineForTrafficWithAbTests(
  engine: ShadowEngineDefinition,
  decisionId: string,
) {
  if (!shouldRunEngineForTraffic(engine, decisionId)) return false;
  try {
    const { resolveAbTestTrafficForEngine } = await import("@/src/server/shadow-validation/ab-test.service");
    return resolveAbTestTrafficForEngine(engine.engineId, decisionId);
  } catch {
    return true;
  }
}
