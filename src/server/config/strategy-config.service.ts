import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/server/db/prisma";

const ACTIVE_KEY = "strategy.config.active";
const VERSION_COUNTER_KEY = "strategy.config.version_counter";
const VERSION_PREFIX = "strategy.config.version.";
const CACHE_TTL_MS = 45_000;

type StrategyConfigEnvelope = {
  version: number;
  config: StrategyConfig;
  updatedAt: string;
  updatedBy?: string;
  note?: string;
};

const tradeSchema = z.object({
  budgetPerTradeTry: z.number().positive().max(10_000_000),
  maxOpenPositions: z.number().int().min(1).max(50),
  targetProfitPercent: z.number().positive().max(50),
  stopLossPercent: z.number().positive().max(50),
  trailingStopEnabled: z.boolean(),
  maxWaitSec: z.number().int().min(30).max(86_400),
  cooldownSec: z.number().int().min(0).max(86_400),
  allowSameCoinReentry: z.boolean(),
});

const aiSchema = z.object({
  aiScoreThreshold: z.number().min(0).max(100),
  technicalMinScore: z.number().min(0).max(100),
  newsMinScore: z.number().min(0).max(100),
  riskVetoLevel: z.number().min(0).max(100),
  consensusMinScore: z.number().min(0).max(100),
  noTradeThreshold: z.number().min(0).max(100),
});

const autoRoundSchema = z.object({
  totalRounds: z.number().int().min(1).max(200),
  waitBetweenRoundsSec: z.number().int().min(0).max(86_400),
  onRoundFailure: z.enum(["continue", "pause", "stop"]),
  onLoss: z.enum(["continue", "stop"]),
  onProfit: z.enum(["continue", "stop"]),
});

const coinFilterSchema = z.object({
  bannedCoins: z.array(z.string().min(3).max(20)).max(500),
  allowedCoins: z.array(z.string().min(3).max(20)).max(500),
  minVolume24h: z.number().min(0),
  maxSpreadPercent: z.number().min(0).max(100),
  maxVolatilityPercent: z.number().min(0).max(100),
});

const reportSchema = z.object({
  defaultDateRange: z.enum(["daily", "weekly", "monthly", "custom"]),
  exportFormats: z.array(z.enum(["csv", "json", "xlsx"])).min(1),
  includeCommission: z.boolean(),
});

const strategyConfigSchema = z.object({
  trade: tradeSchema,
  ai: aiSchema,
  autoRound: autoRoundSchema,
  coinFilter: coinFilterSchema,
  report: reportSchema,
});

export type StrategyConfig = z.infer<typeof strategyConfigSchema>;

const DEFAULT_CONFIG: StrategyConfig = {
  trade: {
    budgetPerTradeTry: 1_000,
    maxOpenPositions: 1,
    targetProfitPercent: 2,
    stopLossPercent: 1,
    trailingStopEnabled: true,
    maxWaitSec: 900,
    cooldownSec: 900,
    allowSameCoinReentry: false,
  },
  ai: {
    aiScoreThreshold: 70,
    technicalMinScore: 58,
    newsMinScore: 52,
    riskVetoLevel: 75,
    consensusMinScore: 62,
    noTradeThreshold: 45,
  },
  autoRound: {
    totalRounds: 10,
    waitBetweenRoundsSec: 5,
    onRoundFailure: "continue",
    onLoss: "continue",
    onProfit: "continue",
  },
  coinFilter: {
    bannedCoins: [],
    allowedCoins: [],
    minVolume24h: 800_000,
    maxSpreadPercent: 0.25,
    maxVolatilityPercent: 3.4,
  },
  report: {
    defaultDateRange: "weekly",
    exportFormats: ["csv", "json"],
    includeCommission: true,
  },
};

let cache: { data: StrategyConfigEnvelope; expiresAt: number } | null = null;

function fromJson(raw: unknown): StrategyConfigEnvelope | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const parsed = strategyConfigSchema.safeParse(row.config);
  if (!parsed.success) return null;
  const version = Number(row.version ?? 0);
  return {
    version: Number.isFinite(version) && version > 0 ? version : 1,
    config: parsed.data,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString(),
    updatedBy: typeof row.updatedBy === "string" ? row.updatedBy : undefined,
    note: typeof row.note === "string" ? row.note : undefined,
  };
}

function invalidateCache() {
  cache = null;
}

async function upsertSetting(key: string, value: Prisma.InputJsonValue, description: string) {
  return prisma.appSetting.upsert({
    where: { key },
    create: {
      key,
      scope: "GLOBAL",
      value,
      valueType: "json",
      status: "ACTIVE",
      description,
    },
    update: {
      value,
      status: "ACTIVE",
    },
  });
}

async function getVersionCounter() {
  const row = await prisma.appSetting.findUnique({ where: { key: VERSION_COUNTER_KEY } });
  const value = (row?.value as Record<string, unknown> | null) ?? {};
  const current = Number(value.current ?? 0);
  return Number.isFinite(current) && current > 0 ? current : 0;
}

async function setVersionCounter(version: number) {
  await upsertSetting(
    VERSION_COUNTER_KEY,
    {
      current: version,
      updatedAt: new Date().toISOString(),
    } as Prisma.InputJsonValue,
    "Strategy config version counter",
  );
}

async function saveVersion(version: number, envelope: StrategyConfigEnvelope) {
  await upsertSetting(
    `${VERSION_PREFIX}${version}`,
    envelope as unknown as Prisma.InputJsonValue,
    `Strategy config version ${version}`,
  );
}

export async function getActiveStrategyConfig(options?: { bypassCache?: boolean }) {
  if (!options?.bypassCache && cache && cache.expiresAt > Date.now()) {
    return cache.data;
  }
  const row = await prisma.appSetting.findUnique({ where: { key: ACTIVE_KEY } });
  const parsed = fromJson(row?.value);
  if (parsed) {
    cache = { data: parsed, expiresAt: Date.now() + CACHE_TTL_MS };
    return parsed;
  }
  const initial = await saveStrategyConfig({
    config: DEFAULT_CONFIG,
    updatedBy: "system",
    note: "bootstrap default strategy config",
  });
  return initial;
}

export function validateStrategyConfig(raw: unknown) {
  return strategyConfigSchema.safeParse(raw);
}

export async function saveStrategyConfig(input: {
  config: unknown;
  updatedBy?: string;
  note?: string;
}) {
  const parsed = validateStrategyConfig(input.config);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`),
    };
  }
  const nextVersion = (await getVersionCounter()) + 1;
  const envelope: StrategyConfigEnvelope = {
    version: nextVersion,
    config: parsed.data,
    updatedAt: new Date().toISOString(),
    updatedBy: input.updatedBy,
    note: input.note,
  };
  await saveVersion(nextVersion, envelope);
  await upsertSetting(ACTIVE_KEY, envelope as unknown as Prisma.InputJsonValue, "Active strategy config");
  await setVersionCounter(nextVersion);
  invalidateCache();
  cache = { data: envelope, expiresAt: Date.now() + CACHE_TTL_MS };
  return { ok: true as const, data: envelope };
}

export async function listStrategyConfigVersions(limit = 30) {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        startsWith: VERSION_PREFIX,
      },
      status: "ACTIVE",
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(limit, 200)),
  });
  return rows
    .map((row) => fromJson(row.value))
    .filter((x): x is StrategyConfigEnvelope => Boolean(x));
}

export async function rollbackStrategyConfig(input: { version: number; updatedBy?: string; note?: string }) {
  const target = await prisma.appSetting.findUnique({
    where: { key: `${VERSION_PREFIX}${input.version}` },
  });
  const parsed = fromJson(target?.value);
  if (!parsed) {
    return { ok: false as const, error: "Version not found" };
  }
  const saved = await saveStrategyConfig({
    config: parsed.config,
    updatedBy: input.updatedBy,
    note: input.note ?? `rollback_from_v${input.version}`,
  });
  return saved.ok ? { ok: true as const, data: saved.data } : { ok: false as const, error: saved.errors.join("; ") };
}

export function getDefaultStrategyConfig() {
  return DEFAULT_CONFIG;
}
