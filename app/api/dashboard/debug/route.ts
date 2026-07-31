import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { getExchangeProvider } from "@/src/server/exchange";
import { listExecutionEvents } from "@/src/server/execution/execution-event-bus";
import { getRuntimeExecutionContext, listOpenPositionsByUser } from "@/src/server/repositories/execution.repository";
import { listLogs } from "@/services/log.service";
import { getScannerWorkerSnapshot } from "@/src/server/scanner";
import type { DashboardDebugSnapshot } from "@/src/types/platform";

function parseMaxOpenFromMessage(message: string) {
  const match = message.match(/max open positions reached\s*\((\d+)\)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

type RawExecutionEvent = {
  executionId?: string;
  symbol?: string;
  stage: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";
  message: string;
  createdAt: string;
  context?: {
    providerResults?: Array<{
      providerId?: string;
      providerName?: string;
      ok?: boolean;
      latencyMs?: number;
      decision?: "BUY" | "SELL" | "HOLD" | "NO_TRADE" | null;
      remote?: boolean;
    }>;
    finalDecision?: "BUY" | "SELL" | "HOLD" | "NO_TRADE";
    confidence?: number;
    finalRiskScore?: number;
    explanation?: string;
    laneProviderMap?: {
      technical?: string;
      momentum?: string;
      risk?: string;
    };
  };
};

export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;

    const symbolRaw = request.nextUrl.searchParams.get("symbol") ?? "";
    const symbol = symbolRaw.trim().toUpperCase();
    if (!symbol) {
      return apiOkFromRequest(request, {
        error: "symbol query param required",
      });
    }

    const { user } = await getRuntimeExecutionContext();
    const [openPositions, scannerSnapshot] = await Promise.all([
      listOpenPositionsByUser(user.id),
      Promise.resolve(getScannerWorkerSnapshot()),
    ]);
    const executionEvents = listExecutionEvents(250) as RawExecutionEvent[];
    const filteredEvents = executionEvents.filter((event) => (event.symbol ?? "").toUpperCase() === symbol);
    const latestExecutionId = filteredEvents[0]?.executionId ?? null;
    const sameExecution = latestExecutionId
      ? filteredEvents.filter((event) => event.executionId === latestExecutionId)
      : filteredEvents;
    const stages = sameExecution.slice(0, 25).map((row) => ({
      stage: row.stage,
      status: row.status,
      message: row.message,
      createdAt: row.createdAt,
    }));

    const scannerDetailed = scannerSnapshot.detailed;
    const scannerCandidate = scannerDetailed?.candidates.find(
      (row) => row.context.symbol.toUpperCase() === symbol,
    );
    const latestAiEvent = sameExecution.find((row) => row.stage === "selection" || row.stage === "scanner");
    const providerRows =
      latestAiEvent?.context?.providerResults?.map((row, index) => ({
        providerId: row.providerId ?? `provider-${index + 1}`,
        providerName: row.providerName ?? row.providerId ?? `provider-${index + 1}`,
        ok: Boolean(row.ok),
        latencyMs: Number(row.latencyMs ?? 0),
        decision: row.decision ?? null,
        remote: Boolean(row.remote),
      })) ?? [];
    const laneProviderMap = latestAiEvent?.context?.laneProviderMap ?? {
      technical: "provider-1",
      momentum: "provider-2",
      risk: "provider-3",
    };

    const runtimeLogs = listLogs(300)
      .filter((row) => row.message.toUpperCase().includes(symbol))
      .slice(0, 40)
      .map((row) => ({
        level: row.level,
        message: row.message,
        timestamp: row.timestamp,
      }));

    const parsedMaxOpen =
      runtimeLogs
        .map((row) => parseMaxOpenFromMessage(row.message))
        .find((row): row is number => typeof row === "number") ?? null;

    const provider = getExchangeProvider();
    const exchangeSnapshot = {
      ...provider.getRuntimeStatus(),
      endpointHealth: provider.getPublicEndpointHealth().slice(0, 8).map((row) => ({
        base: row.base,
        score: row.score,
        totalCalls: row.totalCalls,
        successes: row.successes,
        failures: row.failures,
        consecutiveFailures: row.consecutiveFailures,
        latencyEwmaMs: row.latencyEwmaMs,
        cooldownUntil: row.cooldownUntil,
      })),
    };

    const response: DashboardDebugSnapshot = {
      symbol,
      scanner: {
        scannedAt: scannerDetailed?.scannedAt ?? null,
        universeTotal: scannerDetailed?.totalSymbols ?? 0,
        scannedCount: scannerDetailed?.totalSymbols ?? 0,
        qualifiedCount: scannerDetailed?.qualifiedSymbols ?? 0,
        aiEvaluatedCount: scannerDetailed?.aiEvaluatedSymbols ?? 0,
        selectedInScanner: Boolean(scannerCandidate),
        context: scannerCandidate
          ? {
              price: scannerCandidate.context.lastPrice,
              volume24h: scannerCandidate.context.volume24h,
              spreadPercent: scannerCandidate.context.spreadPercent,
              volatilityPercent: scannerCandidate.context.volatilityPercent,
              fakeSpikeScore: scannerCandidate.context.fakeSpikeScore,
              tradable: scannerCandidate.context.tradable,
              rejectReasons: scannerCandidate.context.rejectReasons,
              metadata: scannerCandidate.context.metadata,
            }
          : null,
      },
      ai: {
        finalDecision:
          latestAiEvent?.context?.finalDecision ??
          scannerCandidate?.ai?.finalDecision ??
          null,
        finalConfidence:
          latestAiEvent?.context?.confidence ??
          scannerCandidate?.ai?.finalConfidence ??
          null,
        finalRiskScore:
          latestAiEvent?.context?.finalRiskScore ??
          scannerCandidate?.ai?.finalRiskScore ??
          null,
        explanation:
          latestAiEvent?.context?.explanation ??
          scannerCandidate?.ai?.explanation ??
          null,
        providers:
          providerRows.length > 0
            ? providerRows
            : (scannerCandidate?.ai?.outputs ?? []).map((row, index) => ({
                providerId: row.providerId ?? `provider-${index + 1}`,
                providerName: row.providerName ?? row.providerId ?? `provider-${index + 1}`,
                ok: row.ok,
                latencyMs: row.latencyMs,
                decision: row.output?.decision ?? null,
                remote: Boolean((row.output?.metadata as Record<string, unknown> | undefined)?.remote),
                error: row.error,
              })),
        laneProviderMap,
      },
      execution: {
        latestExecutionId,
        stages,
        openPositions: openPositions.length,
        maxOpenPositions: parsedMaxOpen,
      },
      exchange: exchangeSnapshot,
      recentLogs: runtimeLogs,
    };

    return apiOkFromRequest(request, response);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
