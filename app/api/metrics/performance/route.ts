import { NextRequest } from "next/server";
import { apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { getRuntimeExecutionContext } from "@/src/server/repositories/execution.repository";
import {
  getAdaptiveExecutionPolicy,
  getAdaptivePolicyTimeline,
  getPerformanceMetrics,
} from "@/src/server/metrics/performance.service";

function localizeReasonCodes(reasonCodes: string[], tr: boolean) {
  const dictionary: Record<string, { tr: string; en: string }> = {
    INSUFFICIENT_SAMPLE: {
      tr: "Yeterli islem ornegi yok, baz politika kullaniliyor.",
      en: "Insufficient trade sample, baseline policy active.",
    },
    WR_LT_45: {
      tr: "Win rate %45 altinda, sistem cok sıkı moda gecti.",
      en: "Win rate below 45%, switched to very strict mode.",
    },
    WR_LT_55: {
      tr: "Win rate %55 altinda, confidence eşiği yukseltiliyor.",
      en: "Win rate below 55%, confidence threshold is tightened.",
    },
    WR_LT_62: {
      tr: "Win rate %62 altinda, hafif sıkılaştırma uygulandi.",
      en: "Win rate below 62%, moderate tightening applied.",
    },
    WR_GT_76_RELAX: {
      tr: "Yuksek win rate ve geniş ornek, politika kontrollu gevsetildi.",
      en: "High win rate with large sample, policy slightly relaxed.",
    },
    DD_PRESSURE: {
      tr: "Drawdown baskisi algilandi, koruyucu sıkılaştırma uygulandi.",
      en: "Drawdown pressure detected, defensive tightening applied.",
    },
    STABLE_WINDOW: {
      tr: "Performans stabil, politika korunuyor.",
      en: "Performance is stable, policy remains unchanged.",
    },
  };
  return reasonCodes
    .map((code) => dictionary[code]?.[tr ? "tr" : "en"] ?? code)
    .join(" ");
}

function formatReasonData(
  data: {
    baseMinConfidence: number;
    appliedMinConfidence: number;
    deltaConfidence: number;
    winRatePercent: number;
    maxDrawdown: number;
    netPnl: number;
  },
  tr: boolean,
) {
  const sign = data.deltaConfidence >= 0 ? "+" : "";
  if (tr) {
    return `WR=${data.winRatePercent.toFixed(2)} | DD=${data.maxDrawdown.toFixed(2)} | NetPnL=${data.netPnl.toFixed(2)} | Conf ${data.baseMinConfidence}->${data.appliedMinConfidence} (${sign}${data.deltaConfidence})`;
  }
  return `WR=${data.winRatePercent.toFixed(2)} | DD=${data.maxDrawdown.toFixed(2)} | NetPnL=${data.netPnl.toFixed(2)} | Conf ${data.baseMinConfidence}->${data.appliedMinConfidence} (${sign}${data.deltaConfidence})`;
}

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request);
  if (limited) return limited;
  const tr = getRequestLocale(request) === "tr";

  try {
    const { user } = await getRuntimeExecutionContext();
    const [metrics, adaptive, timeline] = await Promise.all([
      getPerformanceMetrics(user.id),
      getAdaptiveExecutionPolicy(user.id),
      Promise.resolve(getAdaptivePolicyTimeline(user.id, 24)),
    ]);
    const adaptiveLocalized = {
      ...adaptive,
      reason: `${localizeReasonCodes(adaptive.reasonCodes, tr)} ${formatReasonData(adaptive.reasonData, tr)}`.trim(),
    };
    const timelineLocalized = timeline.map((x) => ({
      ...x,
      reason: `${localizeReasonCodes(x.reasonCodes, tr)} ${formatReasonData(x.reasonData, tr)}`.trim(),
    }));
    return apiOkFromRequest(request, { ...metrics, adaptive: adaptiveLocalized, timeline: timelineLocalized });
  } catch {
    const [metrics, adaptive, timeline] = await Promise.all([
      getPerformanceMetrics(),
      getAdaptiveExecutionPolicy(),
      Promise.resolve(getAdaptivePolicyTimeline(undefined, 24)),
    ]);
    const adaptiveLocalized = {
      ...adaptive,
      reason: `${localizeReasonCodes(adaptive.reasonCodes, tr)} ${formatReasonData(adaptive.reasonData, tr)}`.trim(),
    };
    const timelineLocalized = timeline.map((x) => ({
      ...x,
      reason: `${localizeReasonCodes(x.reasonCodes, tr)} ${formatReasonData(x.reasonData, tr)}`.trim(),
    }));
    return apiOkFromRequest(request, { ...metrics, adaptive: adaptiveLocalized, timeline: timelineLocalized });
  }
}

