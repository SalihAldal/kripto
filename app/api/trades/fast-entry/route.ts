import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { env } from "@/lib/config";
import { getRequestLocale } from "@/lib/request-locale";
import { openTrade } from "@/services/trading-engine.service";
import { publishExecutionEvent } from "@/src/server/execution/execution-event-bus";
import { getIdempotencyKey, readIdempotentResponse, writeIdempotentResponse } from "@/src/server/security/idempotency";
import { sanitizePayload, secureRoute } from "@/src/server/security/request-security";
import { getBestFastEntry } from "@/src/server/scanner";

const schema = z.object({
  quantity: z.number().positive().optional(),
  amountTry: z.number().positive().optional(),
  amountUsdt: z.number().positive().optional(),
  maxCoins: z.number().int().min(1).max(5).optional(),
  leverage: z.number().min(1).max(20).optional(),
  execute: z.boolean().default(true).optional(),
  maxDurationSec: z.number().int().positive().max(1200).optional(),
});

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";

  try {
    const access = await secureRoute(request, {
      tr,
      roles: ["ADMIN", "TRADER"],
    });
    if (!access.ok) return access.response;

    const payload = sanitizePayload(await request.json().catch(() => ({})));
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return apiError(tr ? "Gecersiz payload." : "Invalid payload.");
    const idempotencyKey = getIdempotencyKey(request.headers);
    if (idempotencyKey) {
      const cached = await readIdempotentResponse(access.user.id, "fast-entry", idempotencyKey);
      if (cached) return apiOkFromRequest(request, cached);
    }
    const scanExecutionId = `scan-${randomUUID()}`;
    publishExecutionEvent({
      executionId: scanExecutionId,
      stage: "scanner-start",
      status: "RUNNING",
      message: tr ? "Tarama basladi" : "Scanner started",
      level: "INFO",
      context: {
        source: "fast-entry",
      },
    });

    const best = await getBestFastEntry();
    publishExecutionEvent({
      executionId: scanExecutionId,
      symbol: best.selected?.context.symbol,
      stage: "scanner-summary",
      status: "RUNNING",
      message: tr ? "Tarama ozeti hazirlandi" : "Scanner summary ready",
      level: "INFO",
      context: {
        scannedAt: best.scannedAt,
        inspectedCoins: best.evaluated,
        shortlistedCoins: best.diagnostics?.tradableCount ?? 0,
        eliminatedCoins: Math.max(0, (best.diagnostics?.candidateCount ?? 0) - (best.diagnostics?.tradableCount ?? 0)),
        candidateCount: best.diagnostics?.candidateCount ?? 0,
      },
    });
    if (!best.selected || !best.selected.ai) {
      publishExecutionEvent({
        executionId: scanExecutionId,
        stage: "scanner-selection",
        status: "SKIPPED",
        message: tr ? "Uygun coin secilemedi" : "No suitable coin selected",
        level: "WARN",
        context: {
          reason: best.reason,
          diagnostics: best.diagnostics,
        },
      });
      return apiOkFromRequest(request, {
        ok: false,
        scannedAt: best.scannedAt,
        evaluated: best.evaluated,
        reason: tr
          ? `Uygun kisa vade aday bulunamadi. ${best.reason ?? ""}`.trim()
          : `No suitable short-term candidate found. ${best.reason ?? ""}`.trim(),
        diagnostics: best.diagnostics,
      });
    }

    const execute = parsed.data.execute ?? true;
    const selected = best.selected;
    publishExecutionEvent({
      executionId: scanExecutionId,
      symbol: selected.context.symbol,
      stage: "scanner-selection",
      status: "SUCCESS",
      message: tr ? "Coin secimi tamamlandi" : "Coin selected",
      level: "SIGNAL",
      context: {
        selectedCoin: selected.context.symbol,
        shortlistCount: best.diagnostics?.tradableCount ?? 0,
        selectedReason: selected.ai?.explanation ?? (tr ? "AI consensus + skor uyumu" : "AI consensus and score fit"),
        scannerScore: selected.score.score,
        aiConfidence: selected.ai?.finalConfidence,
      },
    });
    if (env.BINANCE_PLATFORM === "tr" && !selected.context.symbol.toUpperCase().endsWith("TRY")) {
      return apiOkFromRequest(request, {
        ok: false,
        scannedAt: best.scannedAt,
        evaluated: best.evaluated,
        reason: tr ? "TL disi parite engellendi. Sadece TRY market kullanilir." : "Non-TRY pair blocked. TRY markets only.",
      });
    }
    const ai = selected.ai;
    if (!ai) {
      return apiOkFromRequest(request, {
        ok: false,
        scannedAt: best.scannedAt,
        evaluated: best.evaluated,
        reason: tr ? "AI sonucu uygun degil" : "AI result is not suitable",
      });
    }
    const duration = parsed.data.maxDurationSec ?? Math.max(300, env.EXECUTION_DEFAULT_MAX_DURATION_SEC);
    const quantity = parsed.data.quantity ?? undefined;
    const amountTry = parsed.data.amountTry ?? undefined;
    const amountUsdt = parsed.data.amountUsdt ?? undefined;
    const maxCoins = parsed.data.maxCoins ?? undefined;
    const leverage = parsed.data.leverage ?? undefined;
    const execution = execute
      ? await openTrade({
          symbol: selected.context.symbol,
          quantity,
          amountTry,
          amountUsdt,
          maxCoins,
          leverage,
          maxDurationSec: duration,
        })
      : null;
    const noTradeFlow = Boolean(execution && execution.rejected && execution.rejectReason?.includes("No tradeable candidate"));
    const pendingOrderStatus = String((execution?.details as { orderStatus?: string } | undefined)?.orderStatus ?? "").toUpperCase();
    const pendingFlow = Boolean(execution && !execution.rejected && !execution.opened && (pendingOrderStatus === "NEW" || pendingOrderStatus === "PARTIALLY_FILLED"));
    const executionFailed = Boolean(execution && (execution.rejected || !execution.opened));
    const executionReason =
      (pendingFlow
        ? tr
          ? "Emir gonderildi, borsa onayi bekleniyor."
          : "Order submitted, waiting for exchange confirmation."
        : undefined) ??
      execution?.rejectReason ??
      (executionFailed
        ? tr
          ? "Islem acilamadi."
          : "Trade could not be opened."
        : undefined);

    const responsePayload = {
      ok: noTradeFlow ? false : (pendingFlow ? true : !executionFailed),
      scanExecutionId,
      scannedAt: best.scannedAt,
      evaluated: best.evaluated,
      diagnostics: best.diagnostics,
      execute,
      reason: executionReason,
      selected: {
        symbol: selected.context.symbol,
        decision: ai.finalDecision,
        aiConfidence: ai.finalConfidence,
        scannerScore: selected.score.score,
        decisionPayload: ai.decisionPayload,
        roleScores: ai.roleScores,
        shortMomentumPercent: Number(selected.context.metadata.shortMomentumPercent ?? 0),
        shortFlowImbalance: Number(selected.context.metadata.shortFlowImbalance ?? 0),
      },
      sizing: {
        amountTry,
        amountUsdt,
        maxCoins,
        leverage: leverage ?? 1,
      },
      execution,
    };
    if (idempotencyKey) {
      await writeIdempotentResponse(access.user.id, "fast-entry", idempotencyKey, responsePayload as Record<string, unknown>);
    }
    return apiOkFromRequest(request, responsePayload);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
