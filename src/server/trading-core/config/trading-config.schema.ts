import { z } from "zod";

const riskLevelSchema = z.enum(["LOW", "MID", "HIGH"]);

const strategyConfigSchema = z.object({
  enabled: z.boolean().default(true),
  minScore: z.number().min(0).max(100).default(60),
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
});

const botConfigSchema = z.object({
  enabled: z.boolean().default(true),
  minScore: z.number().min(0).max(100),
  maxOpenPositions: z.number().int().min(0).max(50),
  cooldownMsAfterLoss: z.number().int().min(0).max(86_400_000),
});

const userConfigSchema = z.object({
  leverage: z.number().int().min(1).max(125).optional(),
  riskLevel: riskLevelSchema.optional(),
  maxDailyLossPercent: z.number().min(0).max(100).optional(),
  maxOpenPositions: z.number().int().min(0).max(50).optional(),
  coinWhitelist: z.array(z.string().min(2).max(30)).optional(),
});

export const tradingRuntimeConfigSchema = z.object({
  leverage: z.number().int().min(1).max(125),
  riskLevel: riskLevelSchema,
  maxDailyLossPercent: z.number().min(0).max(100),
  maxDrawdownPercent: z.number().min(0).max(100),
  maxOpenPositions: z.number().int().min(0).max(50),
  minLiquidationDistancePercent: z.number().min(0).max(100),
  takeProfitPercent: z.number().min(0).max(100),
  stopLossPercent: z.number().min(0).max(100),
  trailingActivationPercent: z.number().min(0).max(100),
  trailingDistancePercent: z.number().min(0).max(100),
  autoBreakevenActivationPercent: z.number().min(0).max(100),
  partialTakeProfitPercent: z.number().min(0).max(100),
  partialTakeProfitQuantityPercent: z.number().min(0).max(100),
  aiConfidenceThreshold: z.number().min(0).max(100),
  aiTimeoutMs: z.number().int().min(100).max(60_000),
  aiServiceUrl: z.string().url(),
  coinWhitelist: z.array(z.string().min(2).max(30)).min(1),
  cooldownMsAfterDeny: z.number().int().min(0).max(86_400_000),
  strategy: z.record(z.string(), strategyConfigSchema),
  bots: z.record(z.string(), botConfigSchema),
  users: z.record(z.string(), userConfigSchema),
});

export const tradingConfigPatchSchema = z.object({
  scope: z.enum(["global", "strategy", "bot", "user"]),
  key: z.string().min(1).max(120),
  value: z.unknown(),
});
