import type {
  ForensicRegimeClass,
  ForensicSessionContext,
  P1ForensicSessionBundle,
} from "@/src/server/forensics/forensic.types";
import { buildEvCalibrationReport } from "@/src/server/forensics/ev-calibration.service";
import { buildEvComponentAttributionReport } from "@/src/server/forensics/ev-component-attribution.service";
import {
  analyzeMeanReversionPerformance,
  buildStrategyPerformanceReport,
  filterMeanReversionEntries,
} from "@/src/server/forensics/mean-reversion-regime-audit.service";
import { buildMrRegimeGatingExperiment } from "@/src/server/forensics/mr-regime-gating-experiment.service";
import { buildOpportunityFunnelReport } from "@/src/server/forensics/opportunity-funnel.service";
import { buildFeeAwareEdgeResearchReport } from "@/src/server/forensics/fee-aware-edge-research.service";
import { evaluatePromotionGate } from "@/src/server/forensics/promotion-gate.service";
import { buildStrategyRegimeMatrix } from "@/src/server/forensics/promotion-gate.service";
import {
  buildScannerQualificationRejections,
  mapMissedStage,
  resolvePrimaryScannerRejection,
} from "@/src/server/forensics/scanner-qualification-forensics.service";
import {
  buildLossPatternReport,
  buildWinningPatternReport,
} from "@/src/server/forensics/trade-pattern-analysis.service";
import type { MarketContext, ScannerScore } from "@/src/types/scanner";
import type { NotDiscoveredAnalysisRecord, ScannerQualificationRejection } from "@/src/server/forensics/forensic.types";

export function analyzePostEntryNotDiscovered(input: {
  symbol: string;
  subsequentMovePercent?: number;
  watchlist: string[];
  cycleSymbols: string[];
  context?: MarketContext | null;
  score?: ScannerScore | null;
  ranked?: boolean;
  aiScope?: boolean;
  timestamp?: string;
}): NotDiscoveredAnalysisRecord {
  const symbol = input.symbol.toUpperCase();
  const inUniverse = input.watchlist.some((row) => row.toUpperCase() === symbol);
  const inCycle = input.cycleSymbols.some((row) => row.toUpperCase() === symbol);
  const qualificationTrail =
    input.context && input.score
      ? buildScannerQualificationRejections({
          context: input.context,
          score: input.score,
          inCycle,
          inUniverse,
          ranked: Boolean(input.ranked),
          aiScope: Boolean(input.aiScope),
        })
      : buildScannerQualificationRejections({
          context: {
            symbol,
            rejectReasons: [],
            tradable: false,
            metadata: {},
          } as MarketContext,
          score: {
            symbol,
            score: 0,
            confidence: 0,
            status: "REJECTED",
            reasons: [],
            metrics: {},
          },
          inCycle,
          inUniverse,
          ranked: false,
          aiScope: false,
        });

  const primary = resolvePrimaryScannerRejection(qualificationTrail);
  const stage = mapMissedStage(qualificationTrail);

  return {
    symbol,
    stage,
    filter: primary?.filter ?? "unknown",
    reasonCode: primary?.reasonCode ?? "NOT_DISCOVERED",
    reasonDetail: primary?.reasonDetail ?? "No scanner qualification trail available",
    threshold: primary?.threshold,
    actualValue: primary?.actualValue,
    analysisScope: "POST_ENTRY_ANALYSIS",
    subsequentMovePercent: input.subsequentMovePercent,
    timestamp: input.timestamp ?? new Date().toISOString(),
    qualificationTrail,
  };
}

function resolveTradeContext(session: ForensicSessionContext) {
  const strategyByTradeId: Record<string, string> = {};
  const regimeByTradeId: Record<string, ForensicRegimeClass> = {};
  for (const order of session.orders) {
    if (order.positionId) {
      const mr = (session.meanReversionEntries ?? []).find((row) => row.tradeId === order.positionId);
      if (mr) {
        strategyByTradeId[order.positionId] = mr.strategyId;
        regimeByTradeId[order.positionId] = mr.forensicRegime;
      }
    }
  }
  for (const pnl of session.pnlEntries) {
    if (!strategyByTradeId[pnl.tradeId]) {
      const mr = (session.meanReversionEntries ?? []).find((row) => row.tradeId === pnl.tradeId);
      if (mr) {
        strategyByTradeId[pnl.tradeId] = mr.strategyId;
        regimeByTradeId[pnl.tradeId] = mr.forensicRegime;
      }
    }
  }
  const exitForensicsByTradeId = Object.fromEntries(
    session.pnlEntries.filter((row) => row.exitForensics).map((row) => [row.tradeId, row.exitForensics!]),
  );
  const entryTimingBySymbol = Object.fromEntries(
    (session.entryTimingRecords ?? []).map((row) => [row.symbol.toUpperCase(), row]),
  );
  return { strategyByTradeId, regimeByTradeId, exitForensicsByTradeId, entryTimingBySymbol };
}

export function buildP1ForensicReports(session: ForensicSessionContext): P1ForensicSessionBundle {
  const mrEntries = filterMeanReversionEntries(session.meanReversionEntries ?? []);
  const { strategyByTradeId, regimeByTradeId, exitForensicsByTradeId, entryTimingBySymbol } =
    resolveTradeContext(session);

  const meanReversionAnalysis = analyzeMeanReversionPerformance({
    entries: mrEntries,
    pnlEntries: session.pnlEntries,
    exitForensics: session.pnlEntries
      .filter((row) => row.exitForensics)
      .map((row) => ({ ...row.exitForensics!, tradeId: row.tradeId })),
  });

  const evCalibration = buildEvCalibrationReport({
    evAudits: session.evAudits,
    pnlEntries: session.pnlEntries,
  });
  const evComponentAttribution = buildEvComponentAttributionReport({ evAudits: session.evAudits });
  const strategyPerformance = buildStrategyPerformanceReport({
    pnlEntries: session.pnlEntries,
    strategyByTradeId,
    regimeByTradeId,
    exitForensicsByTradeId,
  });
  const strategyRegimeMatrix = buildStrategyRegimeMatrix({
    pnlEntries: session.pnlEntries,
    strategyByTradeId,
    regimeByTradeId,
  });
  const mrRegimeGatingExperiment = buildMrRegimeGatingExperiment({
    mrEntries,
    pnlEntries: session.pnlEntries,
  });
  const opportunityFunnel = buildOpportunityFunnelReport(session);
  const lossPatterns = buildLossPatternReport({
    pnlEntries: session.pnlEntries,
    strategyByTradeId,
    regimeByTradeId,
    entryTimingBySymbol,
  });
  const winningPatterns = buildWinningPatternReport({
    pnlEntries: session.pnlEntries,
    strategyByTradeId,
    regimeByTradeId,
    entryTimingBySymbol,
  });
  const feeAwareEdgeResearch = buildFeeAwareEdgeResearchReport({
    decisions: session.decisions,
    evAudits: session.evAudits,
  });
  const promotionGate = evaluatePromotionGate({
    changeId: "mr-regime-gating-v1",
    description: "MR regime filter research candidate",
    before: mrRegimeGatingExperiment.baseline,
    after: mrRegimeGatingExperiment.candidate,
    sampleSize: mrRegimeGatingExperiment.sampleSize,
    minSampleSize: 20,
    acceptanceTest: "tests/forensics/p1-profitability-engineering.test.ts",
  });

  return {
    meanReversionEntries: session.meanReversionEntries ?? [],
    meanReversionAnalysis,
    scannerQualificationRejections: session.scannerQualificationRejections ?? [],
    notDiscoveredRecords: session.notDiscoveredRecords ?? [],
    entryTimingRecords: session.entryTimingRecords ?? [],
    evCalibration,
    evComponentAttribution,
    strategyPerformance,
    strategyRegimeMatrix,
    mrRegimeGatingExperiment,
    opportunityFunnel,
    lossPatterns,
    winningPatterns,
    feeAwareEdgeResearch,
    promotionGate,
  };
}

export function recordScannerQualificationTrail(input: {
  rejections: ScannerQualificationRejection[];
}) {
  return input.rejections;
}
