import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const jobId = process.argv[2] ?? "cmtasbdi60029unbwdxrckdxb";

async function main() {
  const rounds = await p.autoRoundRun.findMany({
    where: { jobId },
    orderBy: { roundNo: "asc" },
    select: {
      roundNo: true,
      symbol: true,
      state: true,
      failReason: true,
      selectedReason: true,
      metadata: true,
    },
  });
  for (const r of rounds) {
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    console.log("---ROUND", r.roundNo, r.symbol, r.state);
    console.log("selectedReason:", String(r.selectedReason ?? "").slice(0, 300));
    console.log("fail:", String(r.failReason ?? "").slice(0, 200));
    const keys = [
      "aiFinalDecision",
      "aiConsensusDecision",
      "aiVetoStatus",
      "confidence",
      "technicalRoleScore",
      "sentimentRoleScore",
      "riskRoleScore",
      "compositeAvg",
      "mtfAlignment",
      "scannerScore",
      "scannerConfidence",
      "pumpRisk",
      "spreadPercent",
      "step",
      "learningLane",
      "pumpLane",
      "entryQuality",
      "entryDecision",
      "scannerPolicyAction",
      "consecutiveFilterRejections",
    ];
    for (const k of keys) {
      if (m[k] !== undefined) console.log(`${k}:`, JSON.stringify(m[k]).slice(0, 200));
    }
  }
  await p.$disconnect();
}

main();
