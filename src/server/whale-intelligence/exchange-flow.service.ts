import { persistExchangeFlow } from "@/src/server/whale-intelligence/whale-intelligence.repository";
import { DEFAULT_EXCHANGES, SAMPLE_ASSETS } from "@/src/server/whale-intelligence/whale-intelligence.types";
import { prisma } from "@/src/server/db/prisma";

function randomUsd(min: number, max: number) {
  return Number((min + Math.random() * (max - min)).toFixed(2));
}

export async function monitorExchangeFlows(exchange?: string, limit = 7) {
  const exchanges = exchange ? [exchange] : [...DEFAULT_EXCHANGES];
  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - 60 * 60_000);
  let recorded = 0;

  for (const ex of exchanges.slice(0, limit)) {
    for (const asset of SAMPLE_ASSETS.slice(0, 3)) {
      const inflowUsd = randomUsd(1_000_000, 100_000_000);
      const outflowUsd = randomUsd(1_000_000, 100_000_000);
      await persistExchangeFlow({
        exchange: ex,
        asset,
        direction: inflowUsd > outflowUsd ? "INFLOW" : "OUTFLOW",
        inflowUsd,
        outflowUsd,
        txCount: Math.floor(Math.random() * 500) + 10,
        whaleTxCount: Math.floor(Math.random() * 50),
        periodStart,
        periodEnd,
      });
      recorded += 1;
    }
  }
  return { recorded, exchanges: exchanges.length };
}

export async function getExchangeFlowSummary(exchange?: string) {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const flows = await prisma.exchangeFlow.findMany({
    where: { ...(exchange ? { exchange } : {}), periodEnd: { gte: since } },
    orderBy: { periodEnd: "desc" },
  });
  const byExchange = new Map<string, { inflow: number; outflow: number; net: number }>();
  for (const flow of flows) {
    const bucket = byExchange.get(flow.exchange) ?? { inflow: 0, outflow: 0, net: 0 };
    bucket.inflow += flow.inflowUsd;
    bucket.outflow += flow.outflowUsd;
    bucket.net += flow.netFlowUsd;
    byExchange.set(flow.exchange, bucket);
  }
  return [...byExchange.entries()].map(([ex, data]) => ({ exchange: ex, ...data }));
}
