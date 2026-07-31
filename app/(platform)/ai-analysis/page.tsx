"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/client-api";
import { ToastStack } from "@/src/components/common/toast-stack";
import { AIModelCards } from "@/src/features/dashboard/components/ai-model-cards";
import { NotificationsPanel } from "@/src/features/dashboard/components/notifications-panel";
import { Panel } from "@/src/components/common/panel";
import { PlaceholderChart } from "@/src/components/common/placeholder-chart";
import { useToast } from "@/src/lib/use-toast";
import { useI18n } from "@/src/i18n/provider";
import type { AIModelCard, NotificationItem } from "@/src/types/platform";
import type { ExchangeInfoResponse } from "@/src/types/exchange";

type AIConsensusResult = {
  finalDecision: "BUY" | "SELL" | "HOLD" | "NO_TRADE";
  finalConfidence: number | null;
  finalRiskScore: number | null;
  explanation: string;
  outputs: Array<{
    providerId: string;
    providerName: string;
    ok: boolean;
    latencyMs: number;
    output?: {
      decision: "BUY" | "SELL" | "HOLD" | "NO_TRADE";
      confidence: number;
      reasoningShort: string;
      riskScore: number;
    };
    error?: string;
  }>;
};

function toFixedSafe(value: unknown, digits = 2) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return (0).toFixed(digits);
  return num.toFixed(digits);
}

const FALLBACK_SYMBOLS = ["BTCTRY", "ETHTRY", "SOLTRY", "BNBTRY", "XRPTRY"];

export default function AiAnalysisPage() {
  const { t, localeTag } = useI18n();
  const [symbol, setSymbol] = useState("BTCTRY");
  const [symbols, setSymbols] = useState<string[]>(FALLBACK_SYMBOLS);
  const [symbolsLoading, setSymbolsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AIConsensusResult | null>(null);
  const [cards, setCards] = useState<AIModelCard[]>([]);
  const [feed, setFeed] = useState<NotificationItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { items: toasts, push: pushToast } = useToast();

  useEffect(() => {
    let active = true;
    const loadSymbols = async () => {
      setSymbolsLoading(true);
      try {
        const data = await apiGet<ExchangeInfoResponse>("/api/exchange/exchange-info");
        if (!active) return;
        const nextSymbols = Array.from(
          new Set(
            data.symbols
              .filter((row) => row.status === "TRADING")
              .map((row) => row.symbol.toUpperCase()),
          ),
        ).sort((a, b) => a.localeCompare(b));
        if (nextSymbols.length > 0) {
          setSymbols(nextSymbols);
          setSymbol((current) => (nextSymbols.includes(current) ? current : nextSymbols[0]));
        }
      } catch {
        // Fallback symbols stay active on fetch errors.
      } finally {
        if (active) setSymbolsLoading(false);
      }
    };
    void loadSymbols();
    return () => {
      active = false;
    };
  }, []);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiPost<AIConsensusResult>("/api/ai/consensus", { symbol });
      setResult(data);
      const mapped = data.outputs.map((vote) => ({
        id: vote.providerId,
        model: `${vote.providerName} (${vote.latencyMs}ms)`,
        signal: vote.output?.decision === "NO_TRADE" ? "HOLD" : (vote.output?.decision ?? "HOLD"),
        confidence: Number(((vote.output?.confidence ?? 0) / 100).toFixed(4)),
        reason: vote.output?.reasoningShort ?? vote.error ?? t("aiAnalysis.providerFailed"),
      }));
      setCards(mapped);
      const notificationLevel: NotificationItem["level"] = data.finalDecision === "NO_TRADE" ? "warning" : "success";
      setFeed((prev) => [
        {
          id: `${Date.now()}`,
          title: `${data.finalDecision} / ${symbol}`,
          description: `${data.explanation} | ${t("aiAnalysis.riskScore")}=${toFixedSafe(data.finalRiskScore)}`,
          level: notificationLevel,
          time: new Date().toLocaleTimeString(localeTag),
        },
        ...prev,
      ].slice(0, 10));
      pushToast(`${symbol} ${t("aiAnalysis.completed")}`, "success");
    } catch (err) {
      setError((err as Error).message);
      pushToast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <ToastStack items={toasts} />
      <h1 className="text-3xl font-black tracking-tight">{t("aiAnalysis.title")}</h1>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 space-y-4">
          <div className="glass-panel rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                className="bg-surface-container-low rounded-lg px-4 py-2 border border-outline-variant/30 w-full sm:w-56"
                disabled={symbolsLoading}
              >
                {symbols.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <button
                onClick={run}
                disabled={loading}
                className="px-5 py-2 rounded-lg bg-linear-to-br from-primary to-primary-container text-[#002e6a] font-bold"
              >
                {loading ? t("aiAnalysis.loading") : t("aiAnalysis.start")}
              </button>
            </div>
            <p className="text-xs text-on-surface-variant">
              {symbolsLoading ? t("aiAnalysis.loading") : `${symbols.length} coin`}
            </p>

            {error ? <p className="text-tertiary text-sm">{error}</p> : null}

            {result ? (
              <div className="grid md:grid-cols-3 gap-4">
                <div className="bg-surface-container-low rounded-xl p-4 border border-outline-variant/20">
                  <div className="text-xs text-on-surface-variant">{t("aiAnalysis.finalDecision")}</div>
                  <div className="text-xl font-black mt-2">{result.finalDecision}</div>
                  <div className="text-sm mt-1 text-secondary">{toFixedSafe(result.finalConfidence)}%</div>
                </div>
                <div className="bg-surface-container-low rounded-xl p-4 border border-outline-variant/20">
                  <div className="text-xs text-on-surface-variant">{t("aiAnalysis.riskScore")}</div>
                  <div className="text-xl font-black mt-2">{toFixedSafe(result.finalRiskScore)}</div>
                  <div className="text-sm mt-1 text-on-surface-variant">{symbol}</div>
                </div>
                <div className="bg-surface-container-low rounded-xl p-4 border border-outline-variant/20">
                  <div className="text-xs text-on-surface-variant">{t("aiAnalysis.consensusNote")}</div>
                  <p className="text-xs mt-2 text-on-surface-variant">{result.explanation}</p>
                </div>
              </div>
            ) : null}
          </div>

          <AIModelCards items={cards} loading={loading && cards.length === 0} error={error} onRetry={run} />
          <Panel title={t("aiAnalysis.predictiveTrend")}>
            <PlaceholderChart height={220} />
          </Panel>
        </div>
        <div className="xl:col-span-4">
          <NotificationsPanel items={feed} />
        </div>
      </div>
    </div>
  );
}
