import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { env } from "@/lib/config";
import { getRequestLocale } from "@/lib/request-locale";
import { buildAIInput, runAIConsensusFromInput } from "@/src/server/ai";
import { evaluateLeverageRules } from "@/src/server/ai/leverage-rule-engine";
import type { AIConsensusResult } from "@/src/types/ai";

const schema = z.object({
  symbol: z.string().min(3),
  maxLeverage: z.number().int().min(1).max(20).optional(),
});

function computeExpectedMove(consensus: AIConsensusResult, lastPrice: number) {
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return 0;
  const directional = consensus.outputs
    .filter((x) => x.ok && x.output)
    .map((x) => x.output!)
    .filter((x) => x.decision === consensus.finalDecision && Number.isFinite(x.targetPrice ?? NaN));
  if (directional.length === 0) return 0;
  const values = directional
    .map((x) => {
      const target = Number(x.targetPrice ?? 0);
      if (!Number.isFinite(target) || target <= 0) return null;
      return (Math.abs(target - lastPrice) / lastPrice) * 100;
    })
    .filter((x): x is number => Number.isFinite(x));
  if (values.length === 0) return 0;
  return Number((values.reduce((acc, x) => acc + x, 0) / values.length).toFixed(4));
}

function computeTrendAgreement(consensus: AIConsensusResult) {
  const directional = consensus.outputs
    .filter((x) => x.ok && x.output)
    .map((x) => x.output!.decision)
    .filter((x) => x === "BUY" || x === "SELL");
  if (directional.length === 0) return 0;
  const same = directional.filter((x) => x === consensus.finalDecision).length;
  return Number((same / directional.length).toFixed(4));
}

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;
    if (!checkApiToken(request)) {
      return apiError(tr ? "Yetkisiz." : "Unauthorized.", 401);
    }

    const payload = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return apiError(tr ? "Gecersiz payload." : "Invalid payload.");

    const symbol = parsed.data.symbol.toUpperCase();
    const requestedMaxLeverage = parsed.data.maxLeverage ?? 10;
    const aiInput = await buildAIInput(
      symbol,
      {
        analysisProfile: "LEVERAGE_DEEP",
        analystMode: "ultra",
        objective:
          "Compute a highly selective leverage-ready directional signal with strict risk controls and realistic take-profit horizon.",
      },
      {
        maxRiskPerTrade: 0.8,
        maxLeverage: requestedMaxLeverage,
        maxDailyLossPercent: 1.5,
      },
    );
    const consensus = await runAIConsensusFromInput(aiInput);

    const spreadPercent = Number(aiInput.spread ?? 0);
    const volatilityPercent = Number(aiInput.volatility ?? 0);
    const lastPrice = Number(aiInput.lastPrice ?? 0);
    const expectedMovePercent = computeExpectedMove(consensus, lastPrice);
    const trendAgreementScore = computeTrendAgreement(consensus);
    const leverage = evaluateLeverageRules({
      platform: env.BINANCE_PLATFORM,
      executionMode: env.EXECUTION_MODE,
      consensus,
      spreadPercent,
      volatilityPercent,
      expectedMovePercent,
      trendAgreementScore,
      requestedMaxLeverage,
    });

    const advisory =
      leverage.route === "SPOT_FALLBACK"
        ? tr
          ? "BinanceTR spot modunda kaldiracli islem acilmaz; bu analiz profesyonel yon/riske gore spot fallback onerisi verir."
          : "Leverage route is unavailable on this platform, falling back to spot advisory."
        : leverage.route === "LEVERAGE_DISABLED"
          ? tr
            ? "Risk kurallari kaldiraci devre disi birakti."
            : "Risk rules disabled leverage route."
          : tr
            ? "Kaldirac kosullari uygun."
            : "Leverage conditions are acceptable.";

    return apiOkFromRequest(request, {
      symbol,
      consensus,
      leverage,
      advisory,
      expectedMovePercent,
      trendAgreementScore,
      suggestedMode: leverage.route === "SPOT_FALLBACK" ? "spot" : "leverage",
      autoExecutionEnabled: false,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

