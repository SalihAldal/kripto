import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";

export async function ensureDefaultAbTests() {
  const existing = await prisma.aBTest.count();
  if (existing > 0) return;
  await prisma.aBTest.createMany({
    data: [
      {
        name: "Decision Engine V2 ML vs Rule V1",
        mode: "SHADOW_ONLY",
        trafficPct: 100,
        engineIds: ["decision-engine-v2", "decision-engine-v1"] as Prisma.InputJsonValue,
        active: true,
      },
      {
        name: "Decision Engine Shadow 100%",
        mode: "SHADOW_ONLY",
        trafficPct: 100,
        engineIds: ["decision-engine-v1", "legacy-hybrid"] as Prisma.InputJsonValue,
        active: true,
      },
      {
        name: "Experimental 10% Shadow",
        mode: "TRAFFIC_SPLIT",
        trafficPct: 10,
        engineIds: ["experimental-ai"] as Prisma.InputJsonValue,
        active: true,
      },
      {
        name: "Simulation Research",
        mode: "SIMULATION_ONLY",
        trafficPct: 0,
        engineIds: ["research-ai", "institutional-ai"] as Prisma.InputJsonValue,
        active: true,
      },
    ],
  });
}

export async function listActiveAbTests() {
  await ensureDefaultAbTests();
  return prisma.aBTest.findMany({ where: { active: true }, orderBy: { createdAt: "desc" } });
}

export async function resolveAbTestTrafficForEngine(engineId: string, decisionId: string) {
  const tests = await listActiveAbTests();
  if (tests.length === 0) return true;

  for (const test of tests) {
    const engineIds = Array.isArray(test.engineIds) ? (test.engineIds as string[]) : [];
    if (!engineIds.includes(engineId)) continue;

    if (test.mode === "SIMULATION_ONLY") return false;
    if (test.mode === "SHADOW_ONLY") return true;

    const hash = decisionId.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    const inBucket = hash % 100 < test.trafficPct;
    if (test.name.toLowerCase().includes("ml") && engineId === "decision-engine-v2") {
      return inBucket || test.trafficPct >= 100;
    }
    if (test.name.toLowerCase().includes("rule") && engineId === "decision-engine-v1") {
      return inBucket || test.trafficPct >= 100;
    }
    return inBucket;
  }

  return true;
}
