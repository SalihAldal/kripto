"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/client-api";
import { Panel } from "@/src/components/common/panel";
import { PlaceholderChart } from "@/src/components/common/placeholder-chart";
import { useAsyncState } from "@/src/lib/use-async-state";
import { SummaryCards } from "@/src/features/dashboard/components/summary-cards";
import { MarketScannerTable } from "@/src/features/dashboard/components/market-scanner-table";
import { AIModelCards } from "@/src/features/dashboard/components/ai-model-cards";
import { QuickTradeActionPanel } from "@/src/features/dashboard/components/quick-trade-action-panel";
import type { SellTargetMetric } from "@/src/features/dashboard/components/quick-trade-action-panel";
import { OrderBookPanel } from "@/src/features/dashboard/components/order-book-panel";
import { SystemStatusPanel } from "@/src/features/dashboard/components/system-status-panel";
import { NotificationsPanel } from "@/src/features/dashboard/components/notifications-panel";
import { DebugObservabilityPanel } from "@/src/features/dashboard/components/debug-observability-panel";
import { TradeFlowPanel } from "@/src/features/dashboard/components/trade-flow-panel";
import { AutoRoundControlPanel } from "@/src/features/dashboard/components/auto-round-control-panel";
import { ToastStack } from "@/src/components/common/toast-stack";
import { useToast } from "@/src/lib/use-toast";
import { useI18n } from "@/src/i18n/provider";
import type { AIModelCard, NotificationItem, OrderBookRow, ScannerRow, SummaryCard, TradeLifecycleEvent } from "@/src/types/platform";

type CostProfileKey = "light" | "medium" | "heavy";

const COST_PER_TRADE_USD: Record<
  CostProfileKey,
  { openai: number; claude: number; gemini: number }
> = {
  light: { openai: 0.17 / 350, claude: 0.33 / 350, gemini: 0.12 / 350 },
  medium: { openai: 0.49 / 350, claude: 0.92 / 350, gemini: 0.33 / 350 },
  heavy: { openai: 1.04 / 350, claude: 1.97 / 350, gemini: 0.69 / 350 },
};
const COST_STORAGE_DAILY_KEY = "kinetic.aiCost.dailyTrades";
const COST_STORAGE_PROFILE_KEY = "kinetic.aiCost.profile";
const COST_STORAGE_AVG_TOKENS_KEY = "kinetic.aiCost.avgTokensPerTrade";
const COST_STORAGE_USD_OPENAI_KEY = "kinetic.aiCost.usdPer1k.openai";
const COST_STORAGE_USD_CLAUDE_KEY = "kinetic.aiCost.usdPer1k.claude";
const COST_STORAGE_USD_GEMINI_KEY = "kinetic.aiCost.usdPer1k.gemini";
const BALANCE_CACHE_KEY = "kinetic.balance.lastGood.dashboard";
const DASHBOARD_PASSIVE_MODE = process.env.NEXT_PUBLIC_DASHBOARD_PASSIVE_MODE === "true";
const QUALITY_MODE_LABEL = "ELITE Precision Mod (ultra secici)";

type TradeEvent = TradeLifecycleEvent & {
  context?: {
    tradeSummary?: {
      symbol: string;
      side: "LONG" | "SHORT";
      entryPrice: number;
      exitPrice: number;
      quantity: number;
      netPnl: number;
      closeReason: string;
    };
    [key: string]: unknown;
  };
};

type ClosedTradeSummary = {
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  netPnl: number;
  closeReason: string;
};

type FlowStatus = "idle" | "buy-submitted" | "position-open";

function formatSecondsToMinSec(totalSec: number) {
  const sec = Math.max(0, Math.floor(totalSec));
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}dk ${String(rem).padStart(2, "0")}sn`;
}

function percentDiff(from: number, to: number) {
  if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to) || to <= 0) return null;
  return ((to - from) / from) * 100;
}

type DashboardOverview = {
  summary: SummaryCard[];
  aiCards: AIModelCard[];
  notifications: NotificationItem[];
  lastTrade: {
    orderId: string;
    symbol: string;
    side: "BUY" | "SELL";
    status: string;
    avgExecutionPrice: number;
    quantity: number;
    updatedAt: string;
  } | null;
  lastExecutionEvent: TradeEvent | null;
};

type OrderBookApi = {
  bids: Array<{ price: number; quantity: number }>;
  asks: Array<{ price: number; quantity: number }>;
};

type AIConsensusResult = {
  finalDecision: "BUY" | "SELL" | "HOLD" | "NO_TRADE";
  outputs: Array<{
    providerId: string;
    providerName: string;
    ok: boolean;
    latencyMs: number;
    output?: { decision: "BUY" | "SELL" | "HOLD" | "NO_TRADE"; confidence: number; reasoningShort: string };
    error?: string;
  }>;
};

type LeverageAnalysisResponse = {
  symbol: string;
  advisory: string;
  expectedMovePercent: number;
  trendAgreementScore: number;
  leverage: {
    suggestedLeverage: number;
    maxAllowedLeverage: number;
    profile: "ULTRA_CONSERVATIVE" | "CONSERVATIVE" | "MODERATE" | "AGGRESSIVE";
    canAutoExecute: boolean;
    route: "SPOT_FALLBACK" | "LEVERAGE_DISABLED" | "LEVERAGE_EXECUTION";
    reasons: string[];
    riskBand: "LOW" | "MEDIUM" | "HIGH";
  };
  consensus: {
    finalDecision: "BUY" | "SELL" | "HOLD" | "NO_TRADE";
    finalConfidence: number;
    finalRiskScore: number;
  };
};

type FastEntryResponse = {
  ok: boolean;
  selected?: {
    symbol: string;
    decision: "BUY" | "SELL" | "HOLD" | "NO_TRADE";
    aiConfidence: number;
  };
  execution?: {
    opened?: boolean;
    rejectReason?: string;
    symbol?: string;
  };
  reason?: string;
  sizing?: {
    amountTry?: number;
    amountUsdt?: number;
    leverage?: number;
  };
};

type BalanceSummary = {
  totalAssets: number;
  nonZeroAssets: number;
  exchangePlatform?: string;
  exchangeEnv?: string;
  error?: string | null;
  errorHint?: string | null;
  updatedAt: string;
  balances: Array<{ asset: string; free: number; locked: number; total: number }>;
};

type TickerSnapshot = {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
};

function mergeNotifications(prev: NotificationItem[], incoming: NotificationItem[]) {
  const out: NotificationItem[] = [];
  const seen = new Set<string>();
  for (const row of [...incoming, ...prev]) {
    const key = `${row.id}-${row.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= 14) break;
  }
  return out;
}

function sameOrderBook(prev: OrderBookRow[], next: OrderBookRow[]) {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (a.side !== b.side || a.price !== b.price || a.amount !== b.amount || a.total !== b.total) return false;
  }
  return true;
}

function toTryDisplaySymbol(symbol: string) {
  const normalized = symbol.toUpperCase();
  if (normalized.endsWith("USDT")) return `${normalized.slice(0, -4)}TRY`;
  return normalized;
}

export default function DashboardPage() {
  const { t, localeTag } = useI18n();
  const [activeSymbol, setActiveSymbol] = useState("BTCTRY");
  const [loading, setLoading] = useState(false);
  const [liveNotifications, setLiveNotifications] = useState<NotificationItem[]>([]);
  const [tradeFlowEvents, setTradeFlowEvents] = useState<TradeLifecycleEvent[]>([]);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [aiCards, setAiCards] = useState<AIModelCard[]>([]);
  const [orderBook, setOrderBook] = useState<OrderBookRow[]>([]);
  const [balance, setBalance] = useState<BalanceSummary | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [closedTradeModal, setClosedTradeModal] = useState<ClosedTradeSummary | null>(null);
  const [closedTradeQueue, setClosedTradeQueue] = useState<ClosedTradeSummary[]>([]);
  const [flowStatus, setFlowStatus] = useState<FlowStatus>("idle");
  const [flowExecutionId, setFlowExecutionId] = useState<string | null>(null);
  const [flowSymbol, setFlowSymbol] = useState<string | null>(null);
  const [flowExpectedSellAt, setFlowExpectedSellAt] = useState<number | null>(null);
  const [flowRemainingSec, setFlowRemainingSec] = useState<number | null>(null);
  const [flowEntryPrice, setFlowEntryPrice] = useState<number | null>(null);
  const [flowTakeProfitPrice, setFlowTakeProfitPrice] = useState<number | null>(null);
  const [flowStopLossPrice, setFlowStopLossPrice] = useState<number | null>(null);
  const [flowLivePrice, setFlowLivePrice] = useState<number | null>(null);
  const [leverageLoading, setLeverageLoading] = useState(false);
  const [leverageInsightText, setLeverageInsightText] = useState<string | null>(null);
  const [leverageReport, setLeverageReport] = useState<LeverageAnalysisResponse | null>(null);
  const [leverageMax, setLeverageMax] = useState(10);
  const [tradeAmountTry, setTradeAmountTry] = useState(1000);
  const [tradeAmountUsdt, setTradeAmountUsdt] = useState(50);
  const [maxCoins, setMaxCoins] = useState(1);
  const [tradeLeverage, setTradeLeverage] = useState(1);
  const [autoSpotEnabled, setAutoSpotEnabled] = useState(false);
  const [liveMonitoringEnabled, setLiveMonitoringEnabled] = useState(false);
  const [autoNextRunAt, setAutoNextRunAt] = useState<number | null>(null);
  const [autoCountdownSec, setAutoCountdownSec] = useState<number | null>(null);
  const [autoCycleCount, setAutoCycleCount] = useState(0);
  const [dailyTrades, setDailyTrades] = useState(50);
  const [costProfile, setCostProfile] = useState<CostProfileKey>("medium");
  const [avgTokensPerTrade, setAvgTokensPerTrade] = useState(900);
  const [usdPer1kOpenai, setUsdPer1kOpenai] = useState(0.00155);
  const [usdPer1kClaude, setUsdPer1kClaude] = useState(0.0029);
  const [usdPer1kGemini, setUsdPer1kGemini] = useState(0.00105);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const executeTradeRef = useRef<((options?: { forceSpot?: boolean; source?: "manual" | "auto" }) => Promise<void>) | null>(null);
  const autoCycleCounterRef = useRef(0);
  const autoRunningCycleRef = useRef<number | null>(null);
  const lastOverviewFetchRef = useRef(0);
  const { items: toasts, push: pushToast } = useToast();

  const scannerState = useAsyncState(async () => {
    const remote = await apiGet<ScannerRow[]>("/api/market/scan?withAi=0").catch(() => null);
    return remote ?? [];
  }, [] as ScannerRow[]);
  const { reload: reloadScanner, data: scannerData, loading: scannerLoading, error: scannerError } = scannerState;

  const loadOverview = useCallback(async () => {
    const data = await apiGet<DashboardOverview>("/api/dashboard/overview").catch(() => null);
    if (!data) return;
    setOverview(data);
    setAiCards(data.aiCards);
    setLiveNotifications((prev) => mergeNotifications(prev, data.notifications));
  }, []);

  const loadTradeFlowEvents = useCallback(async () => {
    const data = await apiGet<TradeLifecycleEvent[]>("/api/trades/events?limit=120").catch(() => null);
    if (!data) return;
    setTradeFlowEvents(data);
  }, []);

  const pushAutoCycleNotification = useCallback(
    (message: string, level: NotificationItem["level"] = "info") => {
      const now = new Date();
      const row: NotificationItem = {
        id: `auto-cycle-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        title: "Otomatik Spot Cycle",
        description: message,
        level,
        time: now.toLocaleTimeString(localeTag),
      };
      setLiveNotifications((prev) => [row, ...prev].slice(0, 14));
    },
    [localeTag],
  );

  const runAnalyze = async () => {
    setLiveMonitoringEnabled(true);
    setLoading(true);
    try {
      const scanResult = await apiPost<FastEntryResponse>("/api/trades/fast-entry", { execute: false });
      const bestSymbol = scanResult.selected?.symbol;
      if (!scanResult.ok || !bestSymbol) {
        pushToast(scanResult.reason ?? t("dashboard.providerError"), "info");
        return;
      }
      setActiveSymbol(bestSymbol);
      const result = await apiPost<AIConsensusResult>("/api/ai/consensus", { symbol: bestSymbol });
      const mapped: AIModelCard[] = result.outputs.map((row) => ({
        id: row.providerId,
        model: `${row.providerName} (${row.latencyMs}ms)`,
        signal: row.output?.decision === "NO_TRADE" ? "HOLD" : (row.output?.decision ?? "HOLD"),
        confidence: Number(((row.output?.confidence ?? 0) / 100).toFixed(4)),
        reason: row.output?.reasoningShort ?? row.error ?? t("dashboard.providerError"),
      }));
      setAiCards(mapped);
      pushToast(`${bestSymbol} ${t("dashboard.analyzeDone")}`, "success");
      void Promise.all([loadOverview(), reloadScanner()]);
    } finally {
      setLoading(false);
    }
  };

  const executeTrade = useCallback(async (options?: { forceSpot?: boolean; source?: "manual" | "auto" }) => {
    setLiveMonitoringEnabled(true);
    const forceSpot = options?.forceSpot ?? false;
    const source = options?.source ?? "manual";
    const effectiveLeverage = forceSpot ? 1 : tradeLeverage;
    const effectiveAmountTry = tradeAmountTry;
    const effectiveAmountUsdt = tradeAmountUsdt;

    if (source === "auto") {
      const nextCycle = autoCycleCounterRef.current + 1;
      autoCycleCounterRef.current = nextCycle;
      autoRunningCycleRef.current = nextCycle;
      setAutoCycleCount(nextCycle);
      setAutoNextRunAt(Date.now() + 10_000);
      pushAutoCycleNotification(`Cycle #${nextCycle} basladi: analiz ve alim denemesi yapiliyor.`, "info");
    }

    setLoading(true);
    try {
      const response = await apiPost<FastEntryResponse>("/api/trades/fast-entry", {
        execute: true,
        maxDurationSec: 600,
        amountTry: effectiveLeverage > 1 ? undefined : effectiveAmountTry,
        amountUsdt: effectiveLeverage > 1 ? effectiveAmountUsdt : undefined,
        maxCoins,
        leverage: effectiveLeverage,
      });
      if (!response.ok) {
        setFlowStatus("idle");
        setFlowExecutionId(null);
        setFlowSymbol(null);
        setFlowExpectedSellAt(null);
        setFlowRemainingSec(null);
        setFlowEntryPrice(null);
        setFlowTakeProfitPrice(null);
        setFlowStopLossPrice(null);
        setFlowLivePrice(null);
        pushToast(response.reason ?? t("dashboard.providerError"), "info");
        if (source === "auto") {
          const failedCycle = autoRunningCycleRef.current;
          if (failedCycle) {
            pushAutoCycleNotification(`Cycle #${failedCycle} sonuc: uygun islem bulunamadi / acilis reddedildi.`, "warning");
          }
          autoRunningCycleRef.current = null;
          setAutoNextRunAt(Date.now() + 12_000);
        }
        return;
      }
      if (response.execution?.opened) {
        const executionSymbol = response.execution.symbol ?? response.selected?.symbol ?? activeSymbol;
        const symbol = toTryDisplaySymbol(response.selected?.symbol ?? executionSymbol);
        const executionId = (response.execution as { executionId?: string } | undefined)?.executionId ?? null;
        const maxDurationSec = Number((response.execution as { details?: { maxDurationSec?: number } } | undefined)?.details?.maxDurationSec ?? 0);
        setFlowStatus("position-open");
        setFlowExecutionId(executionId);
        setFlowSymbol(symbol);
        setActiveSymbol(symbol);
        if (Number.isFinite(maxDurationSec) && maxDurationSec > 0) {
          const expectedAt = Date.now() + maxDurationSec * 1000;
          setFlowExpectedSellAt(expectedAt);
          setFlowRemainingSec(maxDurationSec);
        } else {
          setFlowExpectedSellAt(null);
          setFlowRemainingSec(null);
        }
        const details = (response.execution as {
          details?: { entryPrice?: number; takeProfitPrice?: number; stopLossPrice?: number; filledQuantity?: number };
        } | undefined)?.details;
        const lastTradePrice = overview?.lastTrade?.symbol === symbol ? overview.lastTrade.avgExecutionPrice : null;
        const entryFromExecution = Number(details?.entryPrice ?? 0);
        setFlowEntryPrice(
          entryFromExecution > 0
            ? entryFromExecution
            : lastTradePrice && Number.isFinite(lastTradePrice) && lastTradePrice > 0
              ? lastTradePrice
              : null,
        );
        setFlowTakeProfitPrice(Number(details?.takeProfitPrice ?? 0) > 0 ? Number(details?.takeProfitPrice) : null);
        setFlowStopLossPrice(Number(details?.stopLossPrice ?? 0) > 0 ? Number(details?.stopLossPrice) : null);
        setFlowLivePrice(null);
        pushToast(`${symbol} ${t("dashboard.tradeFlowStarted")}`, "success");
        if (source === "auto" && autoRunningCycleRef.current) {
          pushAutoCycleNotification(`Cycle #${autoRunningCycleRef.current}: pozisyon acildi, satis kapanisi bekleniyor.`, "success");
        }
        void Promise.all([loadOverview(), reloadScanner()]);
      } else {
        const orderStatus = (response.execution as { details?: { orderStatus?: string } } | undefined)?.details?.orderStatus;
        if (orderStatus === "NEW" || orderStatus === "PARTIALLY_FILLED") {
          const executionSymbol =
            (response.execution as { symbol?: string } | undefined)?.symbol ??
            response.selected?.symbol ??
            activeSymbol;
          const symbol = toTryDisplaySymbol(response.selected?.symbol ?? executionSymbol);
          const executionId = (response.execution as { executionId?: string } | undefined)?.executionId ?? null;
          setFlowStatus("buy-submitted");
          setFlowExecutionId(executionId);
          setFlowSymbol(symbol);
          setActiveSymbol(symbol);
          setFlowExpectedSellAt(null);
          setFlowRemainingSec(null);
          setFlowEntryPrice(null);
          setFlowTakeProfitPrice(null);
          setFlowStopLossPrice(null);
          setFlowLivePrice(null);
          pushToast("Emir gonderildi, borsa onayi bekleniyor.", "info");
          if (source === "auto" && autoRunningCycleRef.current) {
            pushAutoCycleNotification(`Cycle #${autoRunningCycleRef.current}: emir gonderildi, borsa onayi bekleniyor.`, "info");
          }
          void loadOverview();
          return;
        }
        setFlowStatus("idle");
        setFlowExecutionId(null);
        setFlowSymbol(null);
        setFlowExpectedSellAt(null);
        setFlowRemainingSec(null);
        setFlowEntryPrice(null);
        setFlowTakeProfitPrice(null);
        setFlowStopLossPrice(null);
        setFlowLivePrice(null);
        pushToast(response.execution?.rejectReason ?? response.reason ?? t("dashboard.providerError"), "info");
        if (source === "auto") {
          const failedCycle = autoRunningCycleRef.current;
          if (failedCycle) {
            pushAutoCycleNotification(`Cycle #${failedCycle} basarisiz: ${response.execution?.rejectReason ?? response.reason ?? "islem acilamadi"}`, "warning");
          }
          autoRunningCycleRef.current = null;
          setAutoNextRunAt(Date.now() + 12_000);
        }
      }
    } catch (error) {
      const message = (error as Error).message ?? t("dashboard.providerError");
      pushToast(message, "error");
      if (source === "auto") {
        const failedCycle = autoRunningCycleRef.current;
        if (failedCycle) {
          pushAutoCycleNotification(`Cycle #${failedCycle} hata: ${message}`, "error");
        }
        autoRunningCycleRef.current = null;
        setAutoNextRunAt(Date.now() + 20_000);
      }
    } finally {
      setLoading(false);
    }
  }, [maxCoins, pushToast, reloadScanner, t, tradeAmountTry, tradeAmountUsdt, tradeLeverage, activeSymbol, overview?.lastTrade, loadOverview, pushAutoCycleNotification]);

  const startAutoSpotFlow = useCallback(() => {
    setLiveMonitoringEnabled(true);
    setTradeLeverage(1);
    setAutoSpotEnabled(true);
    setAutoCycleCount(0);
    autoCycleCounterRef.current = 0;
    autoRunningCycleRef.current = null;
    setAutoNextRunAt(Date.now());
    pushToast("Otomatik spot dongusu baslatildi.", "success");
  }, [pushToast]);

  const stopAutoSpotFlow = useCallback(() => {
    setAutoSpotEnabled(false);
    setAutoNextRunAt(null);
    setAutoCycleCount(0);
    autoCycleCounterRef.current = 0;
    autoRunningCycleRef.current = null;
    pushToast("Otomatik spot dongusu durduruldu.", "info");
  }, [pushToast]);

  const runLeverageAnalyze = async () => {
    setLeverageLoading(true);
    try {
      const symbol = toTryDisplaySymbol(activeSymbol);
      const data = await apiPost<LeverageAnalysisResponse>("/api/ai/leverage-analysis", {
        symbol,
        maxLeverage: leverageMax,
      });
      const advice = `${data.symbol} | ${data.leverage.profile} | ${data.leverage.suggestedLeverage}x (${data.leverage.route}) | ${data.consensus.finalDecision} ${data.consensus.finalConfidence.toFixed(2)}%`;
      const reason = data.leverage.reasons[0] ?? data.advisory;
      setLeverageInsightText(`${advice} - ${reason}`);
      setLeverageReport(data);
      pushToast(data.advisory, data.leverage.route === "SPOT_FALLBACK" ? "info" : "success");
    } catch (error) {
      const message = (error as Error).message;
      setLeverageInsightText(null);
      setLeverageReport(null);
      pushToast(message, "error");
    } finally {
      setLeverageLoading(false);
    }
  };

  const refreshBalanceNow = async () => {
    const data = await apiGet<BalanceSummary>("/api/exchange/balance?force=1").catch(() => null);
    if (!data) {
      pushToast("Bakiye yenilenemedi.", "error");
      return;
    }
    setBalance(data);
    if ((data.balances?.length ?? 0) > 0 && typeof window !== "undefined") {
      window.localStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify(data));
    }
    pushToast("Bakiye guncellendi.", "success");
  };

  const summary = useMemo(() => overview?.summary ?? [], [overview]);
  const estimatedWeeklyAiCost = useMemo(() => {
    const selected = COST_PER_TRADE_USD[costProfile];
    const weeklyTrades = Math.max(0, dailyTrades) * 7;
    return weeklyTrades * (selected.openai + selected.claude + selected.gemini);
  }, [costProfile, dailyTrades]);
  const tokenWeeklyAiCost = useMemo(() => {
    const weeklyTrades = Math.max(0, dailyTrades) * 7;
    const perTrade =
      (Math.max(0, avgTokensPerTrade) / 1000) *
      (Math.max(0, usdPer1kOpenai) + Math.max(0, usdPer1kClaude) + Math.max(0, usdPer1kGemini));
    return weeklyTrades * perTrade;
  }, [avgTokensPerTrade, dailyTrades, usdPer1kClaude, usdPer1kGemini, usdPer1kOpenai]);
  const resetCostDefaults = () => {
    setDailyTrades(50);
    setCostProfile("medium");
    setAvgTokensPerTrade(900);
    setUsdPer1kOpenai(0.00155);
    setUsdPer1kClaude(0.0029);
    setUsdPer1kGemini(0.00105);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(COST_STORAGE_DAILY_KEY);
      window.localStorage.removeItem(COST_STORAGE_PROFILE_KEY);
      window.localStorage.removeItem(COST_STORAGE_AVG_TOKENS_KEY);
      window.localStorage.removeItem(COST_STORAGE_USD_OPENAI_KEY);
      window.localStorage.removeItem(COST_STORAGE_USD_CLAUDE_KEY);
      window.localStorage.removeItem(COST_STORAGE_USD_GEMINI_KEY);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedDaily = Number(window.localStorage.getItem(COST_STORAGE_DAILY_KEY) ?? "");
    const storedProfile = window.localStorage.getItem(COST_STORAGE_PROFILE_KEY);
    const storedAvgTokens = Number(window.localStorage.getItem(COST_STORAGE_AVG_TOKENS_KEY) ?? "");
    const storedOpenai = Number(window.localStorage.getItem(COST_STORAGE_USD_OPENAI_KEY) ?? "");
    const storedClaude = Number(window.localStorage.getItem(COST_STORAGE_USD_CLAUDE_KEY) ?? "");
    const storedGemini = Number(window.localStorage.getItem(COST_STORAGE_USD_GEMINI_KEY) ?? "");
    const normalizeRate = (value: number) => (value > 1 ? value / 1000 : value);
    if (Number.isFinite(storedDaily) && storedDaily >= 0) {
      setDailyTrades(Math.floor(storedDaily));
    }
    if (storedProfile === "light" || storedProfile === "medium" || storedProfile === "heavy") {
      setCostProfile(storedProfile);
    }
    if (Number.isFinite(storedAvgTokens) && storedAvgTokens >= 0) setAvgTokensPerTrade(storedAvgTokens);
    if (Number.isFinite(storedOpenai) && storedOpenai >= 0) setUsdPer1kOpenai(normalizeRate(storedOpenai));
    if (Number.isFinite(storedClaude) && storedClaude >= 0) setUsdPer1kClaude(normalizeRate(storedClaude));
    if (Number.isFinite(storedGemini) && storedGemini >= 0) setUsdPer1kGemini(normalizeRate(storedGemini));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COST_STORAGE_DAILY_KEY, String(Math.max(0, dailyTrades)));
    window.localStorage.setItem(COST_STORAGE_PROFILE_KEY, costProfile);
    window.localStorage.setItem(COST_STORAGE_AVG_TOKENS_KEY, String(Math.max(0, avgTokensPerTrade)));
    window.localStorage.setItem(COST_STORAGE_USD_OPENAI_KEY, String(Math.max(0, usdPer1kOpenai)));
    window.localStorage.setItem(COST_STORAGE_USD_CLAUDE_KEY, String(Math.max(0, usdPer1kClaude)));
    window.localStorage.setItem(COST_STORAGE_USD_GEMINI_KEY, String(Math.max(0, usdPer1kGemini)));
  }, [avgTokensPerTrade, costProfile, dailyTrades, usdPer1kClaude, usdPer1kGemini, usdPer1kOpenai]);

  useEffect(() => {
    const onVisibilityChange = () => {
      setIsVisible(document.visibilityState === "visible");
    };
    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (DASHBOARD_PASSIVE_MODE || !liveMonitoringEnabled) return;
    const toNotification = (event: TradeEvent): NotificationItem => ({
      id: `${event.executionId ?? event.symbol ?? "trade"}-${event.stage}-${event.status}`,
      title: `${event.symbol ?? t("dashboard.tradeLabel")} / ${event.stage.toUpperCase()} - ${event.status}`,
      description: event.message,
      level:
        event.status === "FAILED"
          ? "error"
          : event.status === "SUCCESS"
            ? "success"
            : event.status === "SKIPPED"
              ? "warning"
              : "info",
      time: new Date(event.createdAt).toLocaleTimeString(localeTag),
    });

    let source: EventSource | null = null;
    const connect = () => {
      source = new EventSource("/api/trades/stream");
      source.onmessage = (raw) => {
        try {
          const event = JSON.parse(raw.data) as TradeEvent;
          const sameFlow =
            !flowExecutionId ||
            event.executionId === flowExecutionId ||
            (event.stage === "position-monitor" &&
              Boolean(flowSymbol) &&
              Boolean(event.symbol) &&
              event.symbol === flowSymbol);
          if (sameFlow) {
            if (event.stage === "order-submit" && (event.status === "RUNNING" || event.status === "PENDING")) {
              setFlowStatus("buy-submitted");
            }
            if (event.stage === "completed" && event.status === "SUCCESS") {
              setFlowStatus("position-open");
              if (event.executionId) setFlowExecutionId(event.executionId);
              if (event.symbol) {
                const displaySymbol = toTryDisplaySymbol(event.symbol);
                setFlowSymbol(displaySymbol);
                setActiveSymbol(displaySymbol);
              }
            }
            if (event.stage === "position-monitor" && event.status === "RUNNING") {
              setFlowStatus("position-open");
              if (event.executionId) setFlowExecutionId(event.executionId);
              if (event.symbol) {
                const displaySymbol = toTryDisplaySymbol(event.symbol);
                setFlowSymbol(displaySymbol);
                setActiveSymbol(displaySymbol);
              }
              const ctx = event.context as { openedAt?: string; maxDurationSec?: number } | undefined;
              const openedAtMs = ctx?.openedAt ? new Date(ctx.openedAt).getTime() : Number.NaN;
              const maxDurationSec = Number(ctx?.maxDurationSec ?? 0);
              if (Number.isFinite(openedAtMs) && openedAtMs > 0 && Number.isFinite(maxDurationSec) && maxDurationSec > 0) {
                const expectedAt = openedAtMs + maxDurationSec * 1000;
                if (Number.isFinite(expectedAt) && expectedAt > Date.now()) {
                  setFlowExpectedSellAt(expectedAt);
                  setFlowRemainingSec(Math.max(0, Math.floor((expectedAt - Date.now()) / 1000)));
                }
              }
            }
            if (event.status === "FAILED" || event.stage === "failed") {
              setFlowStatus("idle");
              setFlowExecutionId(null);
              setFlowSymbol(null);
              setFlowExpectedSellAt(null);
              setFlowRemainingSec(null);
              setFlowEntryPrice(null);
              setFlowTakeProfitPrice(null);
              setFlowStopLossPrice(null);
              setFlowLivePrice(null);
            }
          }
          if (event.status === "FAILED") pushToast(event.message, "error");
          if (event.status === "SUCCESS") pushToast(event.message, "success");
          setTradeFlowEvents((prev) => [event, ...prev].slice(0, 180));
          if (event.stage === "settlement" && event.status === "SUCCESS" && event.context?.tradeSummary) {
            const s = event.context.tradeSummary;
            const pnlLabel = s.netPnl >= 0 ? `+${s.netPnl.toFixed(4)}` : s.netPnl.toFixed(4);
            pushToast(
              `${s.symbol} | Alis: ${s.entryPrice.toFixed(6)} -> Satis: ${s.exitPrice.toFixed(6)} | PnL: ${pnlLabel} | Sebep: ${s.closeReason}`,
              s.netPnl >= 0 ? "success" : "error",
            );
            setClosedTradeQueue((prev) => [...prev, s]);
            setFlowStatus("idle");
            setFlowExecutionId(null);
            setFlowSymbol(null);
            setFlowExpectedSellAt(null);
            setFlowRemainingSec(null);
            setFlowEntryPrice(null);
            setFlowTakeProfitPrice(null);
            setFlowStopLossPrice(null);
            setFlowLivePrice(null);
            if (autoSpotEnabled && autoRunningCycleRef.current) {
              const completedCycle = autoRunningCycleRef.current;
              const pnlLabel = s.netPnl >= 0 ? `+${s.netPnl.toFixed(6)}` : s.netPnl.toFixed(6);
              pushAutoCycleNotification(
                `Cycle #${completedCycle} tamamlandi: ${s.symbol} kapandi, net PnL ${pnlLabel}.`,
                s.netPnl >= 0 ? "success" : "warning",
              );
              autoRunningCycleRef.current = null;
            }
          }
          setLiveNotifications((prev) => [toNotification(event), ...prev].slice(0, 14));
          const now = Date.now();
          if (now - lastOverviewFetchRef.current > 15_000) {
            lastOverviewFetchRef.current = now;
            void loadOverview();
          }
        } catch {
          // noop
        }
      };
      source.addEventListener("snapshot", (raw) => {
        try {
          const snapshot = JSON.parse((raw as MessageEvent).data) as TradeEvent[];
          const mapped = snapshot.slice(0, 8).map(toNotification);
          setLiveNotifications((prev) => [...mapped, ...prev].slice(0, 14));
          setTradeFlowEvents(snapshot.slice(0, 180));
        } catch {
          // noop
        }
      });
      source.onerror = () => {
        source?.close();
        reconnectRef.current = setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      source?.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [autoSpotEnabled, flowExecutionId, flowSymbol, liveMonitoringEnabled, loadOverview, localeTag, pushAutoCycleNotification, pushToast, t]);

  useEffect(() => {
    if (closedTradeModal || closedTradeQueue.length === 0) return;
    const [next, ...rest] = closedTradeQueue;
    setClosedTradeModal(next);
    setClosedTradeQueue(rest);
  }, [closedTradeModal, closedTradeQueue]);

  useEffect(() => {
    if (flowStatus !== "position-open" || !flowExpectedSellAt) {
      setFlowRemainingSec(null);
      return;
    }
    const tick = () => {
      const remain = Math.max(0, Math.floor((flowExpectedSellAt - Date.now()) / 1000));
      setFlowRemainingSec(remain);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [flowExpectedSellAt, flowStatus]);

  useEffect(() => {
    const symbolForFlow = flowSymbol ?? activeSymbol;
    if (flowStatus !== "position-open" || !symbolForFlow) {
      setFlowLivePrice(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const ticker = await apiGet<TickerSnapshot>(`/api/exchange/ticker?symbol=${symbolForFlow}`).catch(() => null);
      if (cancelled || !ticker) return;
      if (Number.isFinite(ticker.price) && ticker.price > 0) {
        setFlowLivePrice(ticker.price);
      }
    };
    void tick();
    const timer = setInterval(() => {
      void tick();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeSymbol, flowStatus, flowSymbol]);

  const sellTargetMetrics = useMemo<SellTargetMetric[] | undefined>(() => {
    if (flowStatus !== "position-open") return undefined;
    const entry = flowEntryPrice;
    const live = flowLivePrice;
    const tp = flowTakeProfitPrice;
    const sl = flowStopLossPrice;
    if (!entry || !live) return undefined;
    const tpRemain = tp ? percentDiff(live, tp) : null;
    const slGap = sl ? percentDiff(sl, live) : null;
    const pnlNow = percentDiff(entry, live);
    const metrics: SellTargetMetric[] = [];
    if (tpRemain !== null) {
      metrics.push({
        label: "TP'ye kalan",
        value: `${tpRemain >= 0 ? "+" : ""}${tpRemain.toFixed(2)}%`,
        tone: tpRemain <= 0.6 ? "positive" : tpRemain <= 1.5 ? "warning" : "neutral",
      });
    }
    if (slGap !== null) {
      metrics.push({
        label: "SL farki",
        value: `${slGap >= 0 ? "+" : ""}${slGap.toFixed(2)}%`,
        tone: slGap <= 0.8 ? "negative" : slGap <= 1.6 ? "warning" : "neutral",
      });
    }
    if (pnlNow !== null) {
      metrics.push({
        label: "Anlik",
        value: `${pnlNow >= 0 ? "+" : ""}${pnlNow.toFixed(2)}%`,
        tone: pnlNow >= 0 ? "positive" : "negative",
      });
    }
    return metrics.length > 0 ? metrics : undefined;
  }, [flowEntryPrice, flowLivePrice, flowStatus, flowStopLossPrice, flowTakeProfitPrice]);

  const sellEtaText = useMemo(() => {
    if (flowStatus !== "position-open" || flowRemainingSec === null) return undefined;
    const etaClock = flowExpectedSellAt ? new Date(flowExpectedSellAt).toLocaleTimeString(localeTag) : "-";
    return `Tahmini satis: ${etaClock} (${formatSecondsToMinSec(flowRemainingSec)} icinde)`;
  }, [flowExpectedSellAt, flowRemainingSec, flowStatus, localeTag]);

  useEffect(() => {
    if (DASHBOARD_PASSIVE_MODE || !liveMonitoringEnabled) return;
    void loadOverview();
    const tick = () => {
      void loadOverview();
      if (isVisible) reloadScanner();
    };
    tick();
    const intervalMs = isVisible ? 20_000 : 60_000;
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [flowStatus, isVisible, liveMonitoringEnabled, loadOverview, reloadScanner]);

  useEffect(() => {
    if (DASHBOARD_PASSIVE_MODE || !liveMonitoringEnabled) return;
    void loadTradeFlowEvents();
    const timer = setInterval(() => {
      if (isVisible) void loadTradeFlowEvents();
    }, isVisible ? 12_000 : 40_000);
    return () => clearInterval(timer);
  }, [isVisible, liveMonitoringEnabled, loadTradeFlowEvents]);

  useEffect(() => {
    executeTradeRef.current = executeTrade;
  }, [executeTrade]);

  useEffect(() => {
    if (DASHBOARD_PASSIVE_MODE || !liveMonitoringEnabled) return;
    if (!autoSpotEnabled) return;
    if (loading) return;
    if (flowStatus !== "idle") return;
    const targetAt = autoNextRunAt ?? Date.now();
    const waitMs = Math.max(0, targetAt - Date.now());
    const timer = setTimeout(() => {
      void executeTradeRef.current?.({ forceSpot: true, source: "auto" });
    }, waitMs);
    return () => clearTimeout(timer);
  }, [autoNextRunAt, autoSpotEnabled, flowStatus, liveMonitoringEnabled, loading]);

  useEffect(() => {
    if (!autoSpotEnabled || !autoNextRunAt) {
      setAutoCountdownSec(null);
      return;
    }
    const tick = () => {
      const remain = Math.max(0, Math.floor((autoNextRunAt - Date.now()) / 1000));
      setAutoCountdownSec(remain);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [autoNextRunAt, autoSpotEnabled]);

  useEffect(() => {
    if (flowStatus !== "idle") return;
    const first = scannerData[0]?.symbol;
    if (first) setActiveSymbol(first);
  }, [flowStatus, scannerData]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cachedRaw = window.localStorage.getItem(BALANCE_CACHE_KEY);
    if (!cachedRaw) return;
    try {
      const cached = JSON.parse(cachedRaw) as BalanceSummary;
      if ((cached.balances?.length ?? 0) > 0) {
        setBalance(cached);
      }
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    if (DASHBOARD_PASSIVE_MODE || !liveMonitoringEnabled) return;
    const loadBalance = async () => {
      const data = await apiGet<BalanceSummary>("/api/exchange/balance").catch(() => null);
      if (data) {
        setBalance((prev) => {
          const hasFresh = (data.balances?.length ?? 0) > 0;
          if (hasFresh) {
            if (typeof window !== "undefined") {
              window.localStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify(data));
            }
            return data;
          }
          if (prev && (prev.balances?.length ?? 0) > 0) {
            return {
              ...prev,
              error: data.error ?? prev.error ?? null,
              errorHint: data.errorHint ?? prev.errorHint ?? null,
              updatedAt: data.updatedAt ?? prev.updatedAt,
            };
          }
          return data;
        });
      }
    };
    void loadBalance();
    const timer = setInterval(() => {
      if (isVisible) void loadBalance();
    }, isVisible ? 60_000 : 120_000);
    return () => clearInterval(timer);
  }, [isVisible, liveMonitoringEnabled]);

  useEffect(() => {
    if (DASHBOARD_PASSIVE_MODE || !liveMonitoringEnabled) return;
    const forceBalanceRefresh = async () => {
      const data = await apiGet<BalanceSummary>("/api/exchange/balance?force=1").catch(() => null);
      if (!data) return;
      setBalance(data);
      if ((data.balances?.length ?? 0) > 0 && typeof window !== "undefined") {
        window.localStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify(data));
      }
    };
    const timer = setInterval(forceBalanceRefresh, 30 * 60 * 1000);
    return () => clearInterval(timer);
  }, [liveMonitoringEnabled]);

  useEffect(() => {
    if (DASHBOARD_PASSIVE_MODE || !liveMonitoringEnabled) return;
    const loadOrderBook = async () => {
      const data = await apiGet<OrderBookApi>(`/api/exchange/orderbook?symbol=${activeSymbol}&limit=6`).catch(() => null);
      if (!data) return;
      const asks = data.asks.slice(0, 3).map((x) => ({
        side: "ask" as const,
        price: x.price,
        amount: x.quantity,
        total: x.price * x.quantity,
      }));
      const bids = data.bids.slice(0, 3).map((x) => ({
        side: "bid" as const,
        price: x.price,
        amount: x.quantity,
        total: x.price * x.quantity,
      }));
      const next = [...asks, ...bids];
      setOrderBook((prev) => (sameOrderBook(prev, next) ? prev : next));
    };
    void loadOrderBook();
    const timer = setInterval(loadOrderBook, isVisible ? 15_000 : 45_000);
    return () => clearInterval(timer);
  }, [activeSymbol, isVisible, liveMonitoringEnabled]);

  return (
    <div className="space-y-5">
      <ToastStack items={toasts} />
      {closedTradeModal ? (
        <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/55 px-4">
          <div className="w-full max-w-md rounded-2xl border border-outline-variant/30 bg-surface p-5 shadow-2xl">
            <h3 className="text-lg font-black tracking-tight">Islem Sonucu</h3>
            <div className="mt-3 overflow-hidden rounded-lg border border-outline-variant/30">
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-outline-variant/20"><td className="px-3 py-2 text-on-surface-variant">Sembol</td><td className="px-3 py-2 text-right font-semibold">{closedTradeModal.symbol}</td></tr>
                  <tr className="border-b border-outline-variant/20"><td className="px-3 py-2 text-on-surface-variant">Yon</td><td className="px-3 py-2 text-right font-semibold">{closedTradeModal.side}</td></tr>
                  <tr className="border-b border-outline-variant/20"><td className="px-3 py-2 text-on-surface-variant">Alis</td><td className="px-3 py-2 text-right font-semibold">{closedTradeModal.entryPrice.toFixed(6)}</td></tr>
                  <tr className="border-b border-outline-variant/20"><td className="px-3 py-2 text-on-surface-variant">Satis</td><td className="px-3 py-2 text-right font-semibold">{closedTradeModal.exitPrice.toFixed(6)}</td></tr>
                  <tr className="border-b border-outline-variant/20"><td className="px-3 py-2 text-on-surface-variant">Lot</td><td className="px-3 py-2 text-right font-semibold">{closedTradeModal.quantity.toFixed(8)}</td></tr>
                  <tr className="border-b border-outline-variant/20"><td className="px-3 py-2 text-on-surface-variant">Kapanis Nedeni</td><td className="px-3 py-2 text-right font-semibold">{closedTradeModal.closeReason}</td></tr>
                  <tr><td className="px-3 py-2 text-on-surface-variant">Net Kar/Zarar</td><td className={`px-3 py-2 text-right font-bold ${closedTradeModal.netPnl >= 0 ? "text-secondary" : "text-tertiary"}`}>{closedTradeModal.netPnl >= 0 ? "+" : ""}{closedTradeModal.netPnl.toFixed(6)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setClosedTradeModal(null)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-black hover:brightness-110"
              >
                Tamam
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight">{t("dashboard.title")}</h1>
          <p className="text-on-surface-variant text-sm mt-1">
            {t("dashboard.subtitle")}
          </p>
          <p className="text-xs mt-1 text-on-surface-variant">
            Canli izleme: {liveMonitoringEnabled ? "acik" : "kapali"} (analiz/trade ile otomatik acilir)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (liveMonitoringEnabled) {
                setLiveMonitoringEnabled(false);
                return;
              }
              setLiveMonitoringEnabled(true);
              void Promise.all([reloadScanner(), loadOverview(), loadTradeFlowEvents()]);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-bold sm:self-auto self-start ${
              liveMonitoringEnabled
                ? "bg-tertiary/15 text-tertiary hover:bg-tertiary/25"
                : "bg-secondary/20 text-secondary hover:bg-secondary/30"
            }`}
          >
            {liveMonitoringEnabled ? "Canli Izleme: Acik" : "Canli Izleme: Kapali"}
          </button>
          <button
            onClick={() => {
              setLiveMonitoringEnabled(true);
              void Promise.all([reloadScanner(), loadOverview(), loadTradeFlowEvents()]);
            }}
            className="px-4 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-sm font-bold sm:self-auto self-start"
          >
            {t("dashboard.refresh")}
          </button>
        </div>
      </div>

      <details className="group rounded-lg border border-tertiary/30 bg-tertiary/10 px-3 py-2">
        <summary className="cursor-pointer list-none text-xs sm:text-sm font-semibold text-on-surface flex items-center gap-2">
          <span className="text-tertiary">⚠</span>
          <span>{t("dashboard.disclaimerSummary")}</span>
        </summary>
        <div className="mt-2 text-[11px] sm:text-xs text-on-surface-variant space-y-1">
          <p className="font-semibold text-on-surface">{t("dashboard.disclaimerTitle")}</p>
          <p>{t("dashboard.disclaimerLine1")}</p>
          <p>{t("dashboard.disclaimerLine2")}</p>
          <p>{t("dashboard.disclaimerLine3")}</p>
          <p>{t("dashboard.disclaimerLine4")}</p>
        </div>
      </details>
      <details className="group rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs">
          <span className="font-bold">{t("systemCommand.aiCostTitle")}</span>
          <span className="text-on-surface-variant">
            {t("systemCommand.weeklyCost")}: ${estimatedWeeklyAiCost.toFixed(2)} | {t("systemCommand.tokenBasedWeekly")}: ${tokenWeeklyAiCost.toFixed(2)}
          </span>
        </summary>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1 text-on-surface-variant">
            {t("systemCommand.dailyTrades")}
            <input
              type="number"
              min={0}
              value={dailyTrades}
              onChange={(e) => setDailyTrades(Math.max(0, Number(e.target.value || 0)))}
              className="w-16 rounded bg-surface-container-high px-2 py-1 text-on-surface"
            />
          </label>
          <label className="flex items-center gap-1 text-on-surface-variant">
            {t("systemCommand.profile")}
            <select
              value={costProfile}
              onChange={(e) => setCostProfile(e.target.value as CostProfileKey)}
              className="rounded bg-surface-container-high px-2 py-1 text-on-surface"
            >
              <option value="light">{t("systemCommand.profileLight")}</option>
              <option value="medium">{t("systemCommand.profileMedium")}</option>
              <option value="heavy">{t("systemCommand.profileHeavy")}</option>
            </select>
          </label>
          <button
            type="button"
            onClick={resetCostDefaults}
            className="rounded bg-surface-container-high px-2 py-1 text-on-surface-variant hover:bg-surface-container"
          >
            {t("systemCommand.resetCostDefaults")}
          </button>
        </div>
      </details>

      <SummaryCards items={summary} loading={!overview && scannerLoading} />

      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 space-y-4">
          <Panel title={t("dashboard.liveChart")}>
            <PlaceholderChart height={260} />
          </Panel>
          <MarketScannerTable
            rows={scannerData}
            loading={scannerLoading && scannerData.length === 0}
            error={scannerError}
            onRetry={reloadScanner}
          />
        </div>
        <div className="xl:col-span-4 space-y-4">
          <QuickTradeActionPanel
            symbol={activeSymbol}
            onAnalyze={runAnalyze}
            onTrade={executeTrade}
            autoModeEnabled={autoSpotEnabled}
            onStartAutoMode={startAutoSpotFlow}
            onStopAutoMode={stopAutoSpotFlow}
            autoStatusLabel={autoSpotEnabled ? "Aktif" : "Pasif"}
            autoCycleText={autoSpotEnabled ? `Cycle #${autoCycleCount}` : undefined}
            qualityModeText={QUALITY_MODE_LABEL}
            autoNextRunText={
              autoSpotEnabled
                ? flowStatus === "position-open"
                  ? "Pozisyon acik: satis/kapanis bekleniyor."
                  : autoCountdownSec !== null
                    ? `Sonraki deneme: ${autoCountdownSec} sn`
                    : "Sonraki deneme planlaniyor..."
                : "Otomatik mod kapali."
            }
            tradeAmount={tradeLeverage > 1 ? tradeAmountUsdt : tradeAmountTry}
            tradeAmountCurrency={tradeLeverage > 1 ? "USDT" : "TRY"}
            onTradeAmountChange={tradeLeverage > 1 ? setTradeAmountUsdt : setTradeAmountTry}
            maxCoins={maxCoins}
            onMaxCoinsChange={setMaxCoins}
            leverage={tradeLeverage}
            onLeverageChange={setTradeLeverage}
            onLeverageAnalyze={runLeverageAnalyze}
            loading={loading}
            leverageLoading={leverageLoading}
            flowActive={flowStatus === "buy-submitted"}
            sellEtaText={sellEtaText}
            sellTargetMetrics={sellTargetMetrics}
            leverageInsightText={leverageInsightText ?? undefined}
            progressText={
              flowStatus === "position-open"
                ? "Pozisyon acik, satis hedefi izleniyor..."
                : flowStatus === "buy-submitted"
                  ? "Alim emri iletildi, dolum/satis akisi bekleniyor..."
                  : overview?.lastExecutionEvent
                    ? `${overview.lastExecutionEvent.stage}: ${overview.lastExecutionEvent.message}`
                    : undefined
            }
          />
          <AutoRoundControlPanel
            livePollingEnabled={liveMonitoringEnabled}
            onNotify={(message, tone) => {
              pushToast(message, tone);
            }}
          />
          <details className="group rounded-xl border border-outline-variant/20 bg-surface/60 p-3">
            <summary className="cursor-pointer list-none text-sm font-bold text-on-surface">
              {t("quickTrade.leveragePanelTitle")}
            </summary>
            <div className="mt-3 space-y-2 text-xs">
              <label className="block">
                <span className="text-on-surface-variant">
                  {t("quickTrade.leverageRequestedMax")}: {leverageMax}x
                </span>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={leverageMax}
                  onChange={(e) => setLeverageMax(Number(e.target.value))}
                  className="mt-1 w-full accent-tertiary"
                />
              </label>
              {leverageReport ? (
                <>
                  <div className="rounded-md border border-outline-variant/30 bg-surface-container-low px-2 py-2">
                    <div className="font-semibold">{leverageReport.symbol}</div>
                    <p className="text-on-surface-variant">{leverageReport.advisory}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded bg-surface-container-low px-2 py-1">{t("quickTrade.leverageRoute")}: {leverageReport.leverage.route}</div>
                    <div className="rounded bg-surface-container-low px-2 py-1">{t("quickTrade.leverageProfile")}: {leverageReport.leverage.profile}</div>
                    <div className="rounded bg-surface-container-low px-2 py-1">{t("quickTrade.leverageSuggested")}: {leverageReport.leverage.suggestedLeverage}x</div>
                    <div className="rounded bg-surface-container-low px-2 py-1">{t("quickTrade.leverageMaxAllowed")}: {leverageReport.leverage.maxAllowedLeverage}x</div>
                    <div className="rounded bg-surface-container-low px-2 py-1">{t("quickTrade.leverageRiskBand")}: {leverageReport.leverage.riskBand}</div>
                    <div className="rounded bg-surface-container-low px-2 py-1">{t("quickTrade.leverageExpectedMove")}: {leverageReport.expectedMovePercent.toFixed(2)}%</div>
                    <div className="rounded bg-surface-container-low px-2 py-1">{t("quickTrade.leverageTrendAgreement")}: {(leverageReport.trendAgreementScore * 100).toFixed(1)}%</div>
                    <div className="rounded bg-surface-container-low px-2 py-1">{t("quickTrade.leverageDecision")}: {leverageReport.consensus.finalDecision}</div>
                    <div className="rounded bg-surface-container-low px-2 py-1">{t("quickTrade.leverageConfidence")}: {leverageReport.consensus.finalConfidence.toFixed(2)}%</div>
                    <div className="rounded bg-surface-container-low px-2 py-1">{t("quickTrade.leverageRiskScore")}: {leverageReport.consensus.finalRiskScore.toFixed(2)}</div>
                  </div>
                  <div className="rounded-md border border-outline-variant/30 bg-surface-container-low px-2 py-2">
                    <p className="mb-1 font-semibold">{t("quickTrade.leverageReasons")}</p>
                    <ul className="space-y-1 text-on-surface-variant">
                      {leverageReport.leverage.reasons.slice(0, 4).map((reason) => (
                        <li key={reason}>- {reason}</li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : (
                <p className="text-on-surface-variant">{t("quickTrade.leverageNoData")}</p>
              )}
            </div>
          </details>
          <Panel title={t("dashboard.lastTradeSummary")}>
            {overview?.lastTrade ? (
              <div className="space-y-1 text-sm">
                <p className="font-bold">{overview.lastTrade.symbol} {overview.lastTrade.side}</p>
                <p className="text-on-surface-variant">{t("dashboard.qty")}: {overview.lastTrade.quantity.toFixed(4)}</p>
                <p className="text-on-surface-variant">{t("dashboard.price")}: {overview.lastTrade.avgExecutionPrice.toFixed(4)}</p>
                <p className="text-xs text-on-surface-variant">
                  {new Date(overview.lastTrade.updatedAt).toLocaleString(localeTag)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-on-surface-variant">{t("dashboard.noLastTrade")}</p>
            )}
          </Panel>
          <Panel title={t("profile.balanceTitle")}>
            <div className="space-y-2 text-xs">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={refreshBalanceNow}
                  className="rounded-md bg-surface-container-high px-2 py-1 text-[11px] font-bold hover:bg-surface-container"
                >
                  Bakiyeyi Simdi Yenile
                </button>
              </div>
              <div className="rounded-md bg-surface-container-low px-2 py-2 flex flex-wrap gap-2">
                <span>{t("profile.total")}: {balance?.nonZeroAssets ?? 0} / {balance?.totalAssets ?? 0}</span>
                <span>platform: {balance?.exchangePlatform ?? "-"}</span>
                <span>env: {balance?.exchangeEnv ?? "-"}</span>
              </div>
              <p className="text-[11px] text-on-surface-variant">
                {t("profile.balanceUpdated")}: {balance?.updatedAt ? new Date(balance.updatedAt).toLocaleTimeString(localeTag) : "-"}
              </p>
              {balance?.error ? <p className="text-[11px] text-tertiary break-all">{balance.error}</p> : null}
              {balance?.errorHint ? <p className="text-[11px] text-on-surface-variant">{balance.errorHint}</p> : null}
              {(balance?.balances?.length ?? 0) > 0 ? (
                <div className="space-y-1">
                  {balance!.balances.slice(0, 4).map((row) => (
                    <div key={row.asset} className="flex items-center justify-between rounded bg-surface-container-low px-2 py-1">
                      <span className="font-semibold">{row.asset}</span>
                      <span className="font-bold">{row.total.toFixed(6)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-on-surface-variant">{t("profile.noBalance")}</p>
              )}
            </div>
          </Panel>
          <OrderBookPanel rows={orderBook} />
          <SystemStatusPanel livePollingEnabled={liveMonitoringEnabled} />
          <details className="group rounded-xl border border-outline-variant/20 bg-surface/60 p-3">
            <summary className="cursor-pointer list-none text-sm font-bold text-on-surface">
              Debug / Gozlemlenebilirlik
            </summary>
            <div className="mt-3">
              <DebugObservabilityPanel symbol={activeSymbol} livePollingEnabled={liveMonitoringEnabled} />
            </div>
          </details>
        </div>
      </section>

      <TradeFlowPanel
        events={tradeFlowEvents}
        loading={!overview && scannerLoading}
        onRefresh={() => {
          void loadTradeFlowEvents();
        }}
      />

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AIModelCards items={aiCards} loading={!overview && scannerLoading && aiCards.length === 0} error={null} onRetry={runAnalyze} />
        <NotificationsPanel items={liveNotifications} />
      </section>
    </div>
  );
}
