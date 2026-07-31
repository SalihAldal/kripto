import { persistStablecoinFlow } from "@/src/server/whale-intelligence/whale-intelligence.repository";
import { DEFAULT_EXCHANGES } from "@/src/server/whale-intelligence/whale-intelligence.types";
import { prisma } from "@/src/server/db/prisma";

const STABLECOINS = ["USDT", "USDC", "DAI", "BUSD"] as const;
const CHAINS = ["ETHEREUM", "BNB", "TRON", "SOLANA"] as const;

function randomUsd(min: number, max: number) {
  return Number((min + Math.random() * (max - min)).toFixed(2));
}

export async function monitorStablecoinFlows(limit = 8) {
  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - 60 * 60_000);
  let recorded = 0;

  for (let i = 0; i < limit; i++) {
    const stablecoin = STABLECOINS[i % STABLECOINS.length]!;
    const chain = CHAINS[i % CHAINS.length]!;
    const exchange = DEFAULT_EXCHANGES[i % DEFAULT_EXCHANGES.length];
    const inflow = randomUsd(5_000_000, 500_000_000);
    const outflow = randomUsd(5_000_000, 500_000_000);
    await persistStablecoinFlow({
      stablecoin,
      chain,
      exchange,
      direction: inflow > outflow ? "INFLOW" : "OUTFLOW",
      amountUsd: inflow + outflow,
      txCount: Math.floor(Math.random() * 1000) + 50,
      netFlowUsd: inflow - outflow,
      periodStart,
      periodEnd,
    });
    recorded += 1;
  }
  return { recorded };
}

export async function getStablecoinFlowSummary() {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const flows = await prisma.stablecoinFlow.findMany({ where: { periodEnd: { gte: since } }, orderBy: { periodEnd: "desc" } });
  const byCoin = new Map<string, { inflow: number; outflow: number; net: number }>();
  for (const flow of flows) {
    const bucket = byCoin.get(flow.stablecoin) ?? { inflow: 0, outflow: 0, net: 0 };
    if (flow.netFlowUsd >= 0) bucket.inflow += flow.amountUsd;
    else bucket.outflow += flow.amountUsd;
    bucket.net += flow.netFlowUsd;
    byCoin.set(flow.stablecoin, bucket);
  }
  return [...byCoin.entries()].map(([stablecoin, data]) => ({ stablecoin, ...data }));
}
