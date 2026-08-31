import type { PaperRuntimeConfig } from "@/src/server/paper-runtime/config";
import { evaluateKillSwitches } from "@/src/server/paper-runtime/kill-switches";
import type { HealthSnapshot } from "@/src/server/paper-runtime/types";

export type PaperRiskInput = {
  symbol: string;
  equity: number;
  peakEquity: number;
  dailyPnl: number;
  openCount: number;
  openNotional: number;
  openSymbols: string[];
  stopPct: number;
  consecutiveLosses: number;
  health: HealthSnapshot;
  now: number;
  wsRecoveredAt?: number | null;
};

export type PaperRiskDecision = {
  verdict: "ALLOW" | "REJECT";
  reasonCodes: string[];
  notional: number;
  quantityHint: number;
  limitsSnapshot: Record<string, number>;
};

export function sizePosition(config: PaperRuntimeConfig, equity: number, stopPct: number) {
  let notional = config.fixedNotional;
  if (config.sizingMode === "equity_percent") notional = equity * config.equityPercent;
  if (config.sizingMode === "risk_per_trade") {
    const stop = Math.max(0.2, stopPct);
    notional = (equity * (config.riskPerTradePercent / 100)) / (stop / 100);
  }
  const maxByPct = equity * (config.maxPositionPercentOfEquity / 100);
  return Math.min(notional, maxByPct, config.maxPositionNotional, equity);
}

export function evaluatePaperRisk(config: PaperRuntimeConfig, input: PaperRiskInput, lastPrice: number): PaperRiskDecision {
  const reasonCodes: string[] = [];
  const kills = evaluateKillSwitches({
    health: input.health,
    config,
    dailyLossPercent: input.equity > 0 ? Math.max(0, (-input.dailyPnl / input.equity) * 100) : 0,
    drawdownPercent: input.peakEquity > 0 ? Math.max(0, ((input.peakEquity - input.equity) / input.peakEquity) * 100) : 0,
    consecutiveLosses: input.consecutiveLosses,
    now: input.now,
    wsRecoveredAt: input.wsRecoveredAt,
  });
  reasonCodes.push(...kills.codes);
  if (input.openCount >= config.maxOpenPositions) reasonCodes.push("RISK_MAX_POSITIONS");
  const notional = sizePosition(config, input.equity, input.stopPct);
  const exposurePct = input.equity > 0 ? (input.openNotional / input.equity) * 100 : 100;
  if (exposurePct > config.maxGrossExposurePercent) reasonCodes.push("RISK_MAX_EXPOSURE");
  const correlated = input.openSymbols.filter((symbol) => sameCluster(symbol, input.symbol)).length;
  if (correlated >= config.maxCorrelatedOpens) reasonCodes.push("RISK_CORRELATED_EXPOSURE");
  const unique = [...new Set(reasonCodes)];
  return {
    verdict: unique.length ? "REJECT" : "ALLOW",
    reasonCodes: unique,
    notional,
    quantityHint: lastPrice > 0 ? notional / lastPrice : 0,
    limitsSnapshot: {
      notional,
      maxOpen: config.maxOpenPositions,
      maxExposurePct: config.maxGrossExposurePercent,
      dailyLossPct: config.maxDailyLossPercent,
      drawdownPct: config.maxDrawdownPercent,
    },
  };
}

function sameCluster(a: string, b: string) {
  const left = a.replace(/USDT|TRY/g, "");
  const right = b.replace(/USDT|TRY/g, "");
  if (left === right) return true;
  const memes = ["DOGE", "SHIB", "PEPE", "FLOKI", "BONK", "WIF", "MEME"];
  return memes.includes(left) && memes.includes(right);
}
