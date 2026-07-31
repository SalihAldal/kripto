import { createHash } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { AdaptiveRegimeLabel, CoinClassificationType, StrategySelectorType } from "@prisma/client";

function key(prefix: string) {
  return `${prefix}_${createHash("sha256").update(`${prefix}_${Date.now()}_${Math.random()}`).digest("hex").slice(0, 16)}`;
}

export async function persistMarketRegime(data: Record<string, unknown>) {
  return prisma.adaptiveMarketRegime.create({ data: { regimeKey: key("reg"), ...data } as never });
}

export async function persistStrategySelection(data: Record<string, unknown>) {
  return prisma.adaptiveStrategySelection.create({ data: { selectionKey: key("sel"), ...data } as never });
}

export async function persistStrategyReplay(data: Record<string, unknown>) {
  return prisma.adaptiveStrategyReplay.create({ data: { replayKey: key("rpl"), ...data } as never });
}

export async function persistStrategyPerformance(data: Record<string, unknown>) {
  return prisma.adaptiveStrategyPerformance.create({ data: { performanceKey: key("perf"), ...data } as never });
}

export async function persistStrategyBenchmark(rankings: Record<string, unknown>[], comparisons: Record<string, unknown>[], winnerStrategy?: StrategySelectorType) {
  return prisma.adaptiveStrategyBenchmark.create({
    data: { benchmarkKey: key("bnch"), rankings: rankings as Prisma.InputJsonValue, comparisons: comparisons as Prisma.InputJsonValue, winnerStrategy },
  });
}

export async function persistStrategySwitch(input: {
  symbol: string;
  fromStrategy: StrategySelectorType;
  toStrategy: StrategySelectorType;
  reason: string;
  positionOpen: boolean;
}) {
  return prisma.adaptiveStrategySwitch.create({ data: { switchKey: key("sw"), recommended: !input.positionOpen, applied: false, ...input } });
}

export async function persistStrategyKnowledge(data: Record<string, unknown>) {
  return prisma.adaptiveStrategyKnowledge.create({ data: { knowledgeKey: key("knw"), ...data } as never });
}

export async function getStrategySelectorDashboard() {
  const [regimes, selections, replays, performances, benchmarks, switches, knowledge, profiles] = await Promise.all([
    prisma.adaptiveMarketRegime.findMany({ orderBy: { detectedAt: "desc" }, take: 20 }),
    prisma.adaptiveStrategySelection.findMany({ orderBy: { selectedAt: "desc" }, take: 30, include: { regime: true, primaryProfile: true } }),
    prisma.adaptiveStrategyReplay.findMany({ orderBy: { replayedAt: "desc" }, take: 20 }),
    prisma.adaptiveStrategyPerformance.findMany({ orderBy: { recordedAt: "desc" }, take: 30 }),
    prisma.adaptiveStrategyBenchmark.findFirst({ orderBy: { generatedAt: "desc" } }),
    prisma.adaptiveStrategySwitch.findMany({ where: { recommended: true, applied: false }, orderBy: { detectedAt: "desc" }, take: 10 }),
    prisma.adaptiveStrategyKnowledge.findMany({ take: 20 }),
    prisma.adaptiveStrategyProfile.findMany({ where: { active: true } }),
  ]);
  const accuracy = replays.length > 0 ? (replays.filter((r) => r.wasBestStrategy).length / replays.length) * 100 : 0;
  return { regimes, selections, replays, performances, benchmarks, switches, knowledge, profiles, stats: { selectionAccuracy: Number(accuracy.toFixed(1)) } };
}

export async function getLatestRegime(symbol?: string) {
  return prisma.adaptiveMarketRegime.findFirst({
    where: symbol ? { symbol: symbol.toUpperCase() } : undefined,
    orderBy: { detectedAt: "desc" },
  });
}

export async function getLatestSelection(symbol?: string) {
  return prisma.adaptiveStrategySelection.findFirst({
    where: symbol ? { symbol: symbol.toUpperCase() } : undefined,
    orderBy: { selectedAt: "desc" },
    include: { regime: true, primaryProfile: true },
  });
}

export async function listSelections(symbol?: string, limit = 30) {
  return prisma.adaptiveStrategySelection.findMany({
    where: symbol ? { symbol: symbol.toUpperCase() } : undefined,
    orderBy: { selectedAt: "desc" },
    take: limit,
    include: { regime: true, primaryProfile: true, replays: true },
  });
}
