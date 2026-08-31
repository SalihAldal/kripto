import { env } from "@/lib/config";
import { deriveExactScannerRejectReason } from "@/src/server/scanner/scanner-reject-telemetry.service";
import type { MarketContext, ScannerScore } from "@/src/types/scanner";
import type { MissedOpportunityStage, ScannerQualificationRejection } from "@/src/server/forensics/forensic.types";

function pushRejection(
  rows: ScannerQualificationRejection[],
  input: Omit<ScannerQualificationRejection, "timestamp"> & { timestamp?: string },
) {
  rows.push({
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
  });
}

export function buildScannerQualificationRejections(input: {
  context: MarketContext;
  score: ScannerScore;
  inCycle: boolean;
  inUniverse: boolean;
  ranked: boolean;
  aiScope: boolean;
}): ScannerQualificationRejection[] {
  const rows: ScannerQualificationRejection[] = [];
  const symbol = input.context.symbol.toUpperCase();

  if (!input.inUniverse) {
    pushRejection(rows, {
      symbol,
      stage: "universe",
      filter: "watchlist_membership",
      reasonCode: "NOT_IN_UNIVERSE",
      exclusionCategory: "SCANNER_ROTATION",
      reasonDetail: "Symbol not present in scanner watchlist universe",
      threshold: "watchlist",
      actualValue: symbol,
      missedOpportunityStage: "NOT_DISCOVERED",
    });
    return rows;
  }

  if (!input.inCycle) {
    pushRejection(rows, {
      symbol,
      stage: "universe",
      filter: "cycle_slice",
      reasonCode: "NOT_IN_CYCLE_SLICE",
      exclusionCategory: "SCANNER_ROTATION",
      reasonDetail: "Symbol in universe but not included in current scanner cycle batch",
      threshold: env.SCANNER_CYCLE_SYMBOL_LIMIT,
      actualValue: "outside_cursor_window",
      missedOpportunityStage: "NOT_DISCOVERED",
    });
  }

  for (const reason of input.context.rejectReasons) {
    if (reason.includes("Low liquidity")) {
      pushRejection(rows, {
        symbol,
        stage: "filter",
        filter: "min_volume_24h",
        reasonCode: "LOW_LIQUIDITY",
        exclusionCategory: "LIQUIDITY",
        reasonDetail: reason,
        threshold: env.SCANNER_MIN_VOLUME_24H,
        actualValue: input.context.volume24h,
        missedOpportunityStage: "DISCOVERED_NOT_QUALIFIED",
      });
    } else if (reason.includes("Spread")) {
      pushRejection(rows, {
        symbol,
        stage: "filter",
        filter: "max_spread_percent",
        reasonCode: "SPREAD_TOO_WIDE",
        exclusionCategory: "SPREAD",
        reasonDetail: reason,
        threshold: env.SCANNER_MAX_SPREAD_PERCENT,
        actualValue: input.context.spreadPercent,
        missedOpportunityStage: "DISCOVERED_NOT_QUALIFIED",
      });
    } else {
      pushRejection(rows, {
        symbol,
        stage: "filter",
        filter: "market_context",
        reasonCode: reason.replace(/\s+/g, "_").toUpperCase().slice(0, 48),
        exclusionCategory: reason.toUpperCase().includes("STALE") ? "STALE_DATA" : "OTHER",
        reasonDetail: reason,
        missedOpportunityStage: "DISCOVERED_NOT_QUALIFIED",
      });
    }
  }

  if (input.score.status === "REJECTED") {
    for (const reason of input.score.reasons) {
      if (reason.includes("Score below threshold")) {
        pushRejection(rows, {
          symbol,
          stage: "qualification",
          filter: "scanner_min_score",
          reasonCode: "SCORE_BELOW_THRESHOLD",
          exclusionCategory: "QUALIFICATION",
          reasonDetail: reason,
          threshold: env.SCANNER_MIN_SCORE,
          actualValue: input.score.score,
          missedOpportunityStage: "DISCOVERED_NOT_QUALIFIED",
        });
      } else if (reason.includes("Directional edge")) {
        pushRejection(rows, {
          symbol,
          stage: "qualification",
          filter: "directional_edge",
          reasonCode: "NO_DIRECTIONAL_EDGE",
          exclusionCategory: "QUALIFICATION",
          reasonDetail: reason,
          missedOpportunityStage: "DISCOVERED_NOT_QUALIFIED",
        });
      } else if (reason.includes("Regime")) {
        pushRejection(rows, {
          symbol,
          stage: "qualification",
          filter: "regime_gate",
          reasonCode: "REGIME_GATE",
          exclusionCategory: "VOLATILITY",
          reasonDetail: reason,
          actualValue: String(input.context.metadata.marketRegime ?? "UNKNOWN"),
          missedOpportunityStage: "DISCOVERED_NOT_QUALIFIED",
        });
      } else if (!rows.some((row) => row.reasonDetail === reason)) {
        pushRejection(rows, {
          symbol,
          stage: "qualification",
          filter: "signal_scoring",
          reasonCode: reason.replace(/\s+/g, "_").toUpperCase().slice(0, 48),
          exclusionCategory: "QUALIFICATION",
          reasonDetail: reason,
          missedOpportunityStage: "DISCOVERED_NOT_QUALIFIED",
        });
      }
    }

    if (!rows.some((row) => row.stage === "qualification" || row.stage === "filter")) {
      const exact = deriveExactScannerRejectReason(input.context, input.score);
      if (exact) {
        const allowedStages = ["filter", "ranking", "universe", "qualification", "candidate_generation"] as const;
        const rejectStage =
          allowedStages.includes(exact.rejectStage as (typeof allowedStages)[number])
            ? (exact.rejectStage as "filter" | "ranking" | "universe" | "qualification" | "candidate_generation")
            : "qualification";
        pushRejection(rows, {
          symbol,
          stage: rejectStage,
          filter: exact.rejectReasonCode.toLowerCase(),
          reasonCode: exact.rejectReasonCode,
          exclusionCategory: exact.rejectReasonCode === "SPREAD_TOO_WIDE" ? "SPREAD" : "QUALIFICATION",
          reasonDetail: exact.rejectReasonDetail,
          missedOpportunityStage: "DISCOVERED_NOT_QUALIFIED",
        });
      }
    }
  }

  if (input.inCycle && input.score.status === "QUALIFIED" && !input.ranked) {
    pushRejection(rows, {
      symbol,
      stage: "candidate_generation",
      filter: "discovery_ranking",
      reasonCode: "NOT_RANKED",
      exclusionCategory: "QUALIFICATION",
      reasonDetail: "Qualified locally but excluded from discovery ranking batch",
      missedOpportunityStage: "DISCOVERED_NOT_QUALIFIED",
    });
  }

  if (input.ranked && !input.aiScope && input.score.status === "QUALIFIED") {
    pushRejection(rows, {
      symbol,
      stage: "candidate_generation",
      filter: "ai_scope_limit",
      reasonCode: "OUTSIDE_AI_SCOPE",
      exclusionCategory: "QUALIFICATION",
      reasonDetail: "Ranked candidate excluded from AI evaluation scope due to top-N limit",
      threshold: env.SCANNER_TOP_CANDIDATES,
      missedOpportunityStage: "DISCOVERED_NOT_QUALIFIED",
    });
  }

  return rows;
}

export function resolvePrimaryScannerRejection(rows: ScannerQualificationRejection[]) {
  return rows[0] ?? null;
}

export function mapMissedStage(rows: ScannerQualificationRejection[]): MissedOpportunityStage {
  return rows.find((row) => row.missedOpportunityStage)?.missedOpportunityStage ?? "OTHER";
}
