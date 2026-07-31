import { BotRegistry } from "@/src/server/trading-core/bots/bot-registry";
import { tradingFeatureFlags } from "@/src/server/trading-core/core/feature-flags";
import { clamp } from "@/src/server/trading-core/indicators/math";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import type { BotPausePlan, NoTradeSeverity, NoTradeZone, NoTradeZoneDecision, NoTradeZoneInput, NoTradeZoneType } from "@/src/server/trading-core/no-trade-zone/no-trade-zone-types";

export class NoTradeZoneEngine {
  private readonly registry = new BotRegistry();
  private readonly activeBlocks = new Map<string, NoTradeZoneDecision>();
  private readonly botPauses = new Map<string, BotPausePlan>();

  detect(input: NoTradeZoneInput): NoTradeZoneDecision {
    const blockTtlMs = input.blockTtlMs ?? 10 * 60_000;
    const botPauseTtlMs = input.botPauseTtlMs ?? 15 * 60_000;
    const zones = this.zones(input, blockTtlMs);
    const maxSeverity = this.maxSeverity(zones);
    const blocked = zones.some((zone) => zone.severity === "HIGH" || zone.severity === "CRITICAL");
    const blockUntil = blocked ? new Date(Date.now() + blockTtlMs).toISOString() : undefined;
    const botPausePlan = blocked && input.pauseBots !== false ? this.pausePlan(input, botPauseTtlMs, zones) : [];

    const decision: NoTradeZoneDecision = {
      symbol: input.symbol.toUpperCase(),
      blocked,
      severity: maxSeverity,
      blockUntil,
      zones,
      botPausePlan,
      applied: Boolean(input.apply),
      reasons: zones.length > 0 ? zones.map((zone) => zone.reason) : ["No no-trade zone detected"],
      generatedAt: new Date().toISOString(),
    };

    if (blocked) this.activeBlocks.set(decision.symbol, decision);
    if (input.apply) this.apply(decision);

    tradingLogger.warn({
      category: "RISK",
      source: "trading-core.no-trade-zone",
      message: `No-trade zone ${decision.symbol}: ${decision.blocked ? "BLOCKED" : "CLEAR"}`,
      status: decision.blocked ? "FAILED" : "SUCCESS",
      symbol: decision.symbol,
      metricName: "no_trade_zone.count",
      metricValue: zones.length,
      context: { severity: decision.severity, zones: zones.map((zone) => zone.type), applied: decision.applied },
    });
    return decision;
  }

  status() {
    const now = Date.now();
    return {
      activeBlocks: Array.from(this.activeBlocks.values()).filter((decision) => !decision.blockUntil || Date.parse(decision.blockUntil) > now),
      botPauses: Array.from(this.botPauses.values()).filter((plan) => Date.parse(plan.pauseUntil) > now),
      updatedAt: new Date().toISOString(),
    };
  }

  private zones(input: NoTradeZoneInput, ttlMs: number): NoTradeZone[] {
    const blockUntil = new Date(Date.now() + ttlMs).toISOString();
    const spread = input.spreadPercent;
    const volumeRatio = input.volumeRatio ?? input.marketRegime?.metrics.volumeRatio ?? 1;
    const volatility = input.volatilityPercent ?? input.marketRegime?.metrics.volatilityPercent ?? 0;
    const liquidity = input.liquidityUsd ?? 100_000;
    const newsRisk = input.newsRiskScore ?? (volumeRatio >= 3.2 && volatility >= 2.2 ? 80 : 0);
    const fakeBreakout = input.fakeBreakoutScore ?? (input.tradeQuality?.filters.find((filter) => filter.type === "WEAK_BREAKOUT" && !filter.passed)?.score ? 65 : 0);
    const manipulation = input.liquidationHeatmap?.manipulationRiskScore ?? (input.marketRegime?.regime === "MANIPULATION_ZONE" ? 88 : 0);

    return [
      this.zone("MANIPULATION_MARKET", manipulation >= 65, manipulation, manipulation >= 85 ? "CRITICAL" : "HIGH", "Manipulation market detected", blockUntil),
      this.zone("EXTREME_SPREAD", (spread ?? 0) >= 0.75, Number(spread ?? 0) * 100, Number(spread ?? 0) >= 1 ? "CRITICAL" : "HIGH", `Spread is extreme: ${spread}%`, blockUntil),
      this.zone("PRE_NEWS", newsRisk >= 70, newsRisk, newsRisk >= 90 ? "CRITICAL" : "HIGH", `News/pre-news spike risk: ${newsRisk}`, blockUntil),
      this.zone("LOW_VOLUME", volumeRatio <= 0.45, (1 - volumeRatio) * 100, volumeRatio <= 0.25 ? "HIGH" : "MEDIUM", `Volume ratio too low: ${volumeRatio.toFixed(2)}`, blockUntil),
      this.zone("FAKE_BREAKOUT_ENV", fakeBreakout >= 60, fakeBreakout, fakeBreakout >= 82 ? "CRITICAL" : "HIGH", `Fake breakout environment score: ${fakeBreakout}`, blockUntil),
      this.zone("VOLATILITY_SPIKE", volatility >= 5.5, volatility * 12, volatility >= 8 ? "CRITICAL" : "HIGH", `Volatility spike: ${volatility.toFixed(2)}%`, blockUntil),
      this.zone("LOW_LIQUIDITY", liquidity <= 15_000, 100 - liquidity / 200, liquidity <= 5_000 ? "CRITICAL" : "HIGH", `Liquidity too low: ${liquidity.toFixed(2)} USD`, blockUntil),
    ].filter((zone): zone is NoTradeZone => Boolean(zone));
  }

  private zone(type: NoTradeZoneType, active: boolean, score: number, severity: NoTradeSeverity, reason: string, blockUntil: string): NoTradeZone | null {
    if (!active) return null;
    return {
      type,
      severity,
      score: Number(clamp(score, 0, 100).toFixed(2)),
      reason,
      blockUntil,
    };
  }

  private pausePlan(input: NoTradeZoneInput, ttlMs: number, zones: NoTradeZone[]): BotPausePlan[] {
    const pauseUntil = new Date(Date.now() + ttlMs).toISOString();
    const targetBotIds = input.targetBotIds?.length ? input.targetBotIds : this.registry.all().map((bot) => bot.id);
    return targetBotIds.map((botId) => ({
      botId,
      paused: true,
      pauseUntil,
      reason: `Paused by no-trade zone: ${zones.map((zone) => zone.type).join(", ")}`,
    }));
  }

  private apply(decision: NoTradeZoneDecision) {
    if (!decision.blocked) return;
    for (const plan of decision.botPausePlan) {
      tradingFeatureFlags.setModuleEnabled(plan.botId, false);
      this.botPauses.set(plan.botId, plan);
    }
  }

  private maxSeverity(zones: NoTradeZone[]): NoTradeSeverity {
    if (zones.some((zone) => zone.severity === "CRITICAL")) return "CRITICAL";
    if (zones.some((zone) => zone.severity === "HIGH")) return "HIGH";
    if (zones.some((zone) => zone.severity === "MEDIUM")) return "MEDIUM";
    return "LOW";
  }
}

const globalNoTrade = globalThis as typeof globalThis & { __noTradeZoneEngine?: NoTradeZoneEngine };
export const noTradeZoneEngine = globalNoTrade.__noTradeZoneEngine ?? new NoTradeZoneEngine();
globalNoTrade.__noTradeZoneEngine = noTradeZoneEngine;
