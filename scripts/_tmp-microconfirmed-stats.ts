import { prisma } from "@/src/server/db/prisma";

async function main() {
  const rows = await prisma.shadowCandidateOutcome.findMany({
    where: { source: "live" },
    select: { candidateId: true, symbol: true, snapshot: true, journey: true, outcomes: true, detectedAt: true },
    orderBy: { detectedAt: "desc" },
    take: 2000,
  });
  const sample = rows
    .map((r) => {
      const s = (r.snapshot as Record<string, unknown> | null) ?? {};
      const journey = ((r.journey as Array<Record<string, unknown>> | null) ?? []).map((j) => String(j.stage ?? ""));
      const hasConfirmed = journey.includes("MICRO_CONFIRMED");
      const hasReady = journey.includes("EXECUTION_READY");
      const outcomes = (r.outcomes as Array<Record<string, unknown>> | null) ?? [];
      const complete = outcomes.filter((o) => o.complete === true && o.quality === "OK");
      const mfeMax = complete.reduce((m, o) => Math.max(m, Number(o.mfePct ?? 0)), 0);
      return {
        candidateId: r.candidateId,
        symbol: r.symbol,
        hasConfirmed,
        hasReady,
        opportunityScore: Number(s.opportunityScore ?? 0),
        microScore: Number(s.microScore ?? 0),
        liquidityScore: Number(s.liquidityScore ?? 0),
        executionQuality: Number(s.executionQuality ?? 0),
        finalScore: Number(s.finalScore ?? 0),
        mfeMax,
      };
    })
    .filter((r) => r.hasConfirmed);

  const confirmed = sample.length;
  const ready = sample.filter((r) => r.hasReady).length;
  const profitable2 = sample.filter((r) => r.mfeMax >= 2);
  const profitable5 = sample.filter((r) => r.mfeMax >= 5);
  console.log(
    JSON.stringify(
      {
        confirmed,
        ready,
        readyRate: confirmed ? ready / confirmed : 0,
        profitable2: { n: profitable2.length, ready: profitable2.filter((r) => r.hasReady).length },
        profitable5: { n: profitable5.length, ready: profitable5.filter((r) => r.hasReady).length },
        sample: sample.slice(0, 20),
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error((e as Error).message);
  await prisma.$disconnect();
  process.exit(1);
});
