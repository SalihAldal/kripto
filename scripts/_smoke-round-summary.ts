import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const jobId = "cmtr5acps0009un8cgytzyg61";

async function main() {
  const rounds = await p.autoRoundRun.findMany({ where: { jobId }, orderBy: { roundNo: "asc" } });
  const rows = rounds.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    return {
      roundNo: r.roundNo,
      state: r.state,
      symbol: r.symbol,
      failReason: r.failReason,
      terminalReason: meta.terminalReason,
      closeReason: meta.closeReason,
      outcome: (meta.terminalOutcome as { outcome?: string } | undefined)?.outcome,
      executionId: r.executionId,
      buyPrice: r.buyPrice,
    };
  });
  console.log(JSON.stringify({ roundCount: rows.length, rows }, null, 2));
  await p.$disconnect();
}

main();
