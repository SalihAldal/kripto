"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/client-api";
import { ToastStack } from "@/src/components/common/toast-stack";
import { useToast } from "@/src/lib/use-toast";
import { useI18n } from "@/src/i18n/provider";

type CostProfileKey = "light" | "medium" | "heavy";

const COST_PER_TRADE_USD: Record<
  CostProfileKey,
  { openai: number; claude: number; gemini: number }
> = {
  light: {
    openai: 0.17 / 350,
    claude: 0.33 / 350,
    gemini: 0.12 / 350,
  },
  medium: {
    openai: 0.49 / 350,
    claude: 0.92 / 350,
    gemini: 0.33 / 350,
  },
  heavy: {
    openai: 1.04 / 350,
    claude: 1.97 / 350,
    gemini: 0.69 / 350,
  },
};
const COST_STORAGE_DAILY_KEY = "kinetic.aiCost.dailyTrades";
const COST_STORAGE_PROFILE_KEY = "kinetic.aiCost.profile";
const COST_STORAGE_AVG_TOKENS_KEY = "kinetic.aiCost.avgTokensPerTrade";
const COST_STORAGE_USD_OPENAI_KEY = "kinetic.aiCost.usdPer1k.openai";
const COST_STORAGE_USD_CLAUDE_KEY = "kinetic.aiCost.usdPer1k.claude";
const COST_STORAGE_USD_GEMINI_KEY = "kinetic.aiCost.usdPer1k.gemini";

export default function SystemCommandPage() {
  const { t, localeTag } = useI18n();
  const [dailyTrades, setDailyTrades] = useState(50);
  const [costProfile, setCostProfile] = useState<CostProfileKey>("medium");
  const [avgTokensPerTrade, setAvgTokensPerTrade] = useState(900);
  const [usdPer1kOpenai, setUsdPer1kOpenai] = useState(0.00155);
  const [usdPer1kClaude, setUsdPer1kClaude] = useState(0.0029);
  const [usdPer1kGemini, setUsdPer1kGemini] = useState(0.00105);
  const [health, setHealth] = useState<{
    status: string;
    safeMode?: {
      enabled: boolean;
      reason?: string;
      requireManualAck?: boolean;
      updatedAt?: string;
    };
    heartbeats?: Array<{ service: string; status: string; updatedAt: string }>;
    circuits?: Array<{ key: string; state: string; failures: number }>;
    exchangeEndpoints?: Array<{
      base: string;
      score: number;
      totalCalls: number;
      successes: number;
      failures: number;
      consecutiveFailures: number;
      latencyEwmaMs: number;
      lastLatencyMs: number;
      latencySamples: number[];
      cooldownUntil: string | null;
    }>;
    exchangeRuntime?: {
      fallbackActive: boolean;
      globalBanActive: boolean;
      networkCooldownActive: boolean;
      globalBanUntil: string | null;
      networkCooldownUntil: string | null;
    };
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [connectivityBusy, setConnectivityBusy] = useState(false);
  const [publicIpBusy, setPublicIpBusy] = useState(false);
  const [publicIp, setPublicIp] = useState<{
    ip: string | null;
    source: "header" | "outbound" | "unknown";
    hint: string | null;
    checkedAt: string;
  } | null>(null);
  const [authCheckBusy, setAuthCheckBusy] = useState(false);
  const [authCheck, setAuthCheck] = useState<{
    ok: boolean;
    platform: string;
    accountRead: {
      ok: boolean;
      endpoint: string;
      statusCode: number | null;
      code: string | null;
      message: string | null;
      flags?: {
        canTrade: number | null;
        canWithdraw: number | null;
        canDeposit: number | null;
      };
    };
    tradePermission: {
      ok: boolean;
      endpoint: string;
      statusCode: number | null;
      code: string | null;
      message: string | null;
      flags?: {
        canTrade: number | null;
        canWithdraw: number | null;
        canDeposit: number | null;
      };
    };
    checkedAt: string;
    reason: string;
    hint?: string;
    actions?: string[];
    diagnostics?: {
      keyFingerprint: string | null;
      keyLength: number;
      secretLength: number;
      keyEdgeWhitespace: boolean;
      secretEdgeWhitespace: boolean;
      env: "live" | "testnet";
      serverBootedAt: string;
      pid: number;
      apiRestrictions?: {
        endpoint: string;
        ok: boolean;
        statusCode: number | null;
        code: string | null;
        message: string | null;
        source: "sapi" | "open" | "unknown";
        flags: {
          enableReading: boolean | null;
          enableSpotAndMarginTrading: boolean | null;
          enableWithdrawals: boolean | null;
          ipRestrict: boolean | null;
        };
      };
    };
  } | null>(null);
  const [connectivity, setConnectivity] = useState<{
    status: "healthy" | "degraded" | "down";
    okCount: number;
    total: number;
    provider: "binance" | "okx";
    exchangeEnv: "live" | "testnet";
    checkedAt: string;
    checks: Array<{
      id: string;
      label: string;
      url: string;
      ok: boolean;
      statusCode: number | null;
      latencyMs: number;
      error: string | null;
      checkedAt: string;
    }>;
  } | null>(null);
  const [performance, setPerformance] = useState<{
    winRatePercent: number;
    closedTrades: number;
    avgHoldSec: number;
    netPnl: number;
    maxDrawdown: number;
    modelHitRates: Array<{ model: string; hitRatePercent: number; samples: number }>;
    coinHitRates?: Array<{ symbol: string; hitRatePercent: number; samples: number; netPnl: number }>;
    timeBucketHitRates?: Array<{ bucket: string; hitRatePercent: number; samples: number }>;
    bestRules?: Array<{ rule: string; netPnl: number; wins: number; losses: number; samples: number }>;
    worstScenarios?: Array<{ scenario: string; netPnl: number; losses: number; samples: number }>;
    strategyRecommendations?: string[];
    adaptive?: {
      minConfidence: number;
      requireUnanimous: boolean;
      closedTrades: number;
      winRatePercent: number;
      strictness: "normal" | "strict" | "very_strict";
      reason: string;
      reasonCodes: string[];
      reasonData: {
        baseMinConfidence: number;
        appliedMinConfidence: number;
        deltaConfidence: number;
        winRatePercent: number;
        maxDrawdown: number;
        netPnl: number;
      };
    };
    timeline?: Array<{
      at: string;
      minConfidence: number;
      requireUnanimous: boolean;
      closedTrades: number;
      winRatePercent: number;
      strictness: "normal" | "strict" | "very_strict";
      reason: string;
      reasonCodes: string[];
      reasonData: {
        baseMinConfidence: number;
        appliedMinConfidence: number;
        deltaConfidence: number;
        winRatePercent: number;
        maxDrawdown: number;
        netPnl: number;
      };
    }>;
  } | null>(null);
  const [monitoring, setMonitoring] = useState<{
    activeOpenPositions: number;
    pendingOrders: number;
    failedOrders: number;
    apiErrorRatePercent: number;
    tradesLast24h: number;
    workerHealth: { runningJobs: number; status: string };
    queueBacklog: number;
    lastSuccessfulAnalysisAt: string | null;
    criticalAlarms: string[];
  } | null>(null);
  const [auditRows, setAuditRows] = useState<
    Array<{
      id: string;
      action: string;
      entityType: string;
      entityId?: string;
      createdAt: string;
      user?: { email?: string; username?: string };
    }>
  >([]);
  const { items: toasts, push } = useToast();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedDaily = Number(window.localStorage.getItem(COST_STORAGE_DAILY_KEY) ?? "");
    const storedProfile = window.localStorage.getItem(COST_STORAGE_PROFILE_KEY);
    if (Number.isFinite(storedDaily) && storedDaily >= 0) {
      setDailyTrades(Math.floor(storedDaily));
    }
    if (storedProfile === "light" || storedProfile === "medium" || storedProfile === "heavy") {
      setCostProfile(storedProfile);
    }
    const storedAvgTokens = Number(window.localStorage.getItem(COST_STORAGE_AVG_TOKENS_KEY) ?? "");
    const storedOpenai = Number(window.localStorage.getItem(COST_STORAGE_USD_OPENAI_KEY) ?? "");
    const storedClaude = Number(window.localStorage.getItem(COST_STORAGE_USD_CLAUDE_KEY) ?? "");
    const storedGemini = Number(window.localStorage.getItem(COST_STORAGE_USD_GEMINI_KEY) ?? "");
    const normalizeRate = (value: number) => (value > 1 ? value / 1000 : value);
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
    const load = async () => {
      const data = await apiGet<{
        status: string;
        safeMode?: {
          enabled: boolean;
          reason?: string;
          requireManualAck?: boolean;
          updatedAt?: string;
        };
        heartbeats?: Array<{ service: string; status: string; updatedAt: string }>;
        circuits?: Array<{ key: string; state: string; failures: number }>;
        exchangeEndpoints?: Array<{
          base: string;
          score: number;
          totalCalls: number;
          successes: number;
          failures: number;
          consecutiveFailures: number;
          latencyEwmaMs: number;
          lastLatencyMs: number;
          latencySamples: number[];
          cooldownUntil: string | null;
        }>;
        exchangeRuntime?: {
          fallbackActive: boolean;
          globalBanActive: boolean;
          networkCooldownActive: boolean;
          globalBanUntil: string | null;
          networkCooldownUntil: string | null;
        };
      }>("/api/health").catch(() => null);
      if (data) setHealth(data);
      const perf = await apiGet<{
        winRatePercent: number;
        closedTrades: number;
        avgHoldSec: number;
        netPnl: number;
        maxDrawdown: number;
        modelHitRates: Array<{ model: string; hitRatePercent: number; samples: number }>;
        coinHitRates?: Array<{ symbol: string; hitRatePercent: number; samples: number; netPnl: number }>;
        timeBucketHitRates?: Array<{ bucket: string; hitRatePercent: number; samples: number }>;
        bestRules?: Array<{ rule: string; netPnl: number; wins: number; losses: number; samples: number }>;
        worstScenarios?: Array<{ scenario: string; netPnl: number; losses: number; samples: number }>;
        strategyRecommendations?: string[];
        adaptive?: {
          minConfidence: number;
          requireUnanimous: boolean;
          closedTrades: number;
          winRatePercent: number;
          strictness: "normal" | "strict" | "very_strict";
          reason: string;
          reasonCodes: string[];
          reasonData: {
            baseMinConfidence: number;
            appliedMinConfidence: number;
            deltaConfidence: number;
            winRatePercent: number;
            maxDrawdown: number;
            netPnl: number;
          };
        };
        timeline?: Array<{
          at: string;
          minConfidence: number;
          requireUnanimous: boolean;
          closedTrades: number;
          winRatePercent: number;
          strictness: "normal" | "strict" | "very_strict";
          reason: string;
          reasonCodes: string[];
          reasonData: {
            baseMinConfidence: number;
            appliedMinConfidence: number;
            deltaConfidence: number;
            winRatePercent: number;
            maxDrawdown: number;
            netPnl: number;
          };
        }>;
      }>("/api/metrics/performance").catch(() => null);
      if (perf) setPerformance(perf);
      const mon = await apiGet<{
        activeOpenPositions: number;
        pendingOrders: number;
        failedOrders: number;
        apiErrorRatePercent: number;
        tradesLast24h: number;
        workerHealth: { runningJobs: number; status: string };
        queueBacklog: number;
        lastSuccessfulAnalysisAt: string | null;
        criticalAlarms: string[];
      }>("/api/monitoring").catch(() => null);
      if (mon) setMonitoring(mon);
      const audits = await apiGet<
        Array<{
          id: string;
          action: string;
          entityType: string;
          entityId?: string;
          createdAt: string;
          user?: { email?: string; username?: string };
        }>
      >("/api/audit?limit=30").catch(() => null);
      if (audits) setAuditRows(audits);
    };
    void load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadConnectivity = async () => {
      setConnectivityBusy(true);
      try {
        const data = await apiGet<{
          status: "healthy" | "degraded" | "down";
          okCount: number;
          total: number;
          provider: "binance" | "okx";
          exchangeEnv: "live" | "testnet";
          checkedAt: string;
          checks: Array<{
            id: string;
            label: string;
            url: string;
            ok: boolean;
            statusCode: number | null;
            latencyMs: number;
            error: string | null;
            checkedAt: string;
          }>;
        }>("/api/health/connectivity").catch(() => null);
        if (data) setConnectivity(data);
      } finally {
        setConnectivityBusy(false);
      }
    };
    void loadConnectivity();
    const timer = setInterval(loadConnectivity, 20_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadPublicIp = async () => {
      setPublicIpBusy(true);
      try {
        const data = await apiGet<{
          ip: string | null;
          source: "header" | "outbound" | "unknown";
          hint: string | null;
          checkedAt: string;
        }>("/api/network/public-ip").catch(() => null);
        if (data) setPublicIp(data);
      } finally {
        setPublicIpBusy(false);
      }
    };
    void loadPublicIp();
    const timer = setInterval(loadPublicIp, 60_000);
    return () => clearInterval(timer);
  }, []);

  const emergencyStop = async (enabled: boolean) => {
    setBusy(true);
    try {
      await apiPost("/api/trades/emergency-stop", { enabled });
      push(enabled ? t("systemCommand.emergencyOn") : t("systemCommand.emergencyOff"), enabled ? "error" : "success");
    } catch (error) {
      push((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const endpoints = health?.exchangeEndpoints ?? [];
  const bestEndpoint = endpoints[0] ?? null;
  const degradedCount = endpoints.filter((row) => row.consecutiveFailures >= 3).length;
  const measuredEndpoints = endpoints.filter((row) => row.totalCalls > 0);
  const avgLatency = measuredEndpoints.length
    ? Math.round(
        measuredEndpoints.reduce((sum, row) => {
          const observed = row.successes + row.failures;
          const value = observed < 5 && row.lastLatencyMs > 0 ? row.lastLatencyMs : row.latencyEwmaMs;
          return sum + value;
        }, 0) / measuredEndpoints.length,
      )
    : 0;
  const avgLatencyLabel = measuredEndpoints.length > 0 ? `${avgLatency} ms` : "-";
  const runtime = health?.exchangeRuntime;
  const fallbackActive = Boolean(runtime?.fallbackActive);
  const selectedCost = COST_PER_TRADE_USD[costProfile];
  const weeklyTrades = Math.max(0, dailyTrades) * 7;
  const monthlyTrades = Math.max(0, dailyTrades) * 30;
  const weekly = {
    openai: weeklyTrades * selectedCost.openai,
    claude: weeklyTrades * selectedCost.claude,
    gemini: weeklyTrades * selectedCost.gemini,
  };
  const monthly = {
    openai: monthlyTrades * selectedCost.openai,
    claude: monthlyTrades * selectedCost.claude,
    gemini: monthlyTrades * selectedCost.gemini,
  };
  const weeklyTotal = weekly.openai + weekly.claude + weekly.gemini;
  const monthlyTotal = monthly.openai + monthly.claude + monthly.gemini;
  const tokenCostPerTrade = {
    openai: (Math.max(0, avgTokensPerTrade) / 1000) * Math.max(0, usdPer1kOpenai),
    claude: (Math.max(0, avgTokensPerTrade) / 1000) * Math.max(0, usdPer1kClaude),
    gemini: (Math.max(0, avgTokensPerTrade) / 1000) * Math.max(0, usdPer1kGemini),
  };
  const tokenWeekly = {
    openai: weeklyTrades * tokenCostPerTrade.openai,
    claude: weeklyTrades * tokenCostPerTrade.claude,
    gemini: weeklyTrades * tokenCostPerTrade.gemini,
  };
  const tokenMonthly = {
    openai: monthlyTrades * tokenCostPerTrade.openai,
    claude: monthlyTrades * tokenCostPerTrade.claude,
    gemini: monthlyTrades * tokenCostPerTrade.gemini,
  };
  const tokenWeeklyTotal = tokenWeekly.openai + tokenWeekly.claude + tokenWeekly.gemini;
  const tokenMonthlyTotal = tokenMonthly.openai + tokenMonthly.claude + tokenMonthly.gemini;
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
  const connectivityStatusLabel =
    connectivity?.status === "healthy"
      ? t("systemCommand.connectivityStatusHealthy")
      : connectivity?.status === "degraded"
        ? t("systemCommand.connectivityStatusDegraded")
        : t("systemCommand.connectivityStatusDown");
  const connectivityStatusClass =
    connectivity?.status === "healthy"
      ? "bg-secondary/20 text-secondary"
      : connectivity?.status === "degraded"
        ? "bg-primary/20 text-primary"
        : "bg-tertiary/20 text-tertiary";
  const connectivityPlatformLabel =
    connectivity?.provider === "okx" ? "OKX" : connectivity?.provider === "binance" ? "Binance TR" : "Exchange";
  const connectivityCardTitle =
    connectivity?.provider === "okx" || connectivity?.provider === "binance"
      ? `${connectivityPlatformLabel} Connectivity Test`
      : "Exchange Connectivity Test";
  const connectivityCardDesc =
    connectivity?.provider === "okx"
      ? "OKX public endpoint erisimi ve latency durumunu test eder."
      : connectivity?.provider === "binance"
        ? "Binance TR public endpoint erisimi ve latency durumunu test eder."
        : "Public endpoint erisimi ve latency durumunu test eder.";
  const authProvider =
    authCheck?.platform === "okx"
      ? "okx"
      : authCheck?.platform === "binance-tr"
        ? "binance"
        : connectivity?.provider === "okx"
          ? "okx"
          : connectivity?.provider === "binance"
            ? "binance"
            : null;
  const authPlatformLabel =
    authProvider === "okx" ? "OKX" : authProvider === "binance" ? "Binance TR" : "Exchange";
  const authCardTitle =
    authProvider === "okx" || authProvider === "binance" ? `${authPlatformLabel} Auth Test` : "Exchange Auth Test";
  const authCardDesc =
    authProvider === "okx"
      ? "OKX API key/secret/passphrase, hesap okuma ve emir yetkisini tek adimda dogrular."
      : authProvider === "binance"
        ? "Binance TR API key/secret ve Spot Trade (al-sat) yetkisini dogrular. Account read sonucu bilgilendirme amaclidir."
        : "Exchange API yetkilerini tek adimda dogrular.";
  const runAuthCheck = async () => {
    setAuthCheckBusy(true);
    try {
      const data = await apiPost<{
        ok: boolean;
        platform: string;
        accountRead: {
          ok: boolean;
          endpoint: string;
          statusCode: number | null;
          code: string | null;
          message: string | null;
          flags?: {
            canTrade: number | null;
            canWithdraw: number | null;
            canDeposit: number | null;
          };
        };
        tradePermission: {
          ok: boolean;
          endpoint: string;
          statusCode: number | null;
          code: string | null;
          message: string | null;
          flags?: {
            canTrade: number | null;
            canWithdraw: number | null;
            canDeposit: number | null;
          };
        };
        checkedAt: string;
        reason: string;
        hint?: string;
        actions?: string[];
        diagnostics?: {
          keyFingerprint: string | null;
          keyLength: number;
          secretLength: number;
          keyEdgeWhitespace: boolean;
          secretEdgeWhitespace: boolean;
          env: "live" | "testnet";
          serverBootedAt: string;
          pid: number;
          apiRestrictions?: {
            endpoint: string;
            ok: boolean;
            statusCode: number | null;
            code: string | null;
            message: string | null;
            source: "sapi" | "open" | "unknown";
            flags: {
              enableReading: boolean | null;
              enableSpotAndMarginTrading: boolean | null;
              enableWithdrawals: boolean | null;
              ipRestrict: boolean | null;
            };
          };
        };
      }>("/api/exchange/auth-check", {});
      setAuthCheck(data);
      push(data.reason, data.ok ? "success" : "error");
    } catch (error) {
      push((error as Error).message, "error");
    } finally {
      setAuthCheckBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <ToastStack items={toasts} />
      <h1 className="text-3xl font-black tracking-tight">{t("systemCommand.title")}</h1>
      <div className="glass-panel rounded-xl p-6 space-y-4">
        <p className="text-on-surface-variant">
          {t("systemCommand.description")}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg bg-surface-container-low p-4">
            <p className="text-xs text-on-surface-variant uppercase">{t("systemCommand.health")}</p>
            <p className="text-lg font-black mt-2">{health?.status ?? t("systemCommand.loading")}</p>
          </div>
          <div className="rounded-lg bg-surface-container-low p-4">
            <p className="text-xs text-on-surface-variant uppercase">{t("systemCommand.circuitStates")}</p>
            <p className="text-lg font-black mt-2">{health?.circuits?.length ?? 0}</p>
          </div>
          <div className="rounded-lg bg-surface-container-low p-4">
            <p className="text-xs text-on-surface-variant uppercase">{t("systemCommand.bestEndpoint")}</p>
            <p className="text-sm font-black mt-2 break-all">{bestEndpoint?.base ?? t("systemCommand.loading")}</p>
          </div>
          <div className="rounded-lg bg-surface-container-low p-4">
            <p className="text-xs text-on-surface-variant uppercase">{t("systemCommand.degradedEndpoints")}</p>
            <p className="text-lg font-black mt-2">{degradedCount}</p>
            <p className="text-xs text-on-surface-variant mt-1">
              {t("systemCommand.avgLatency")}: {avgLatencyLabel}
            </p>
          </div>
          <div className="rounded-lg bg-surface-container-low p-4">
            <p className="text-xs text-on-surface-variant uppercase">{t("systemCommand.fallbackMode")}</p>
            <p className={`text-sm font-black mt-2 ${fallbackActive ? "text-tertiary" : "text-secondary"}`}>
              {fallbackActive ? t("systemCommand.fallbackActive") : t("systemCommand.fallbackPassive")}
            </p>
            <p className="text-[11px] text-on-surface-variant mt-1">
              ban: {runtime?.globalBanUntil ? new Date(runtime.globalBanUntil).toLocaleTimeString(localeTag) : "-"} | net:{" "}
              {runtime?.networkCooldownUntil ? new Date(runtime.networkCooldownUntil).toLocaleTimeString(localeTag) : "-"}
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-surface-container-low p-4 space-y-3">
          <p className="text-xs text-on-surface-variant uppercase">{t("systemCommand.endpointHealth")}</p>
          {endpoints.length === 0 ? (
            <p className="text-sm text-on-surface-variant">{t("systemCommand.noEndpointData")}</p>
          ) : (
            <div className="space-y-2">
              {endpoints.slice(0, 4).map((row) => {
                const observedCalls = row.successes + row.failures;
                const latencyLabel =
                  observedCalls === 0
                    ? "-"
                    : `${Math.round(observedCalls < 5 && row.lastLatencyMs > 0 ? row.lastLatencyMs : row.latencyEwmaMs)}ms`;
                const scoreLabel = row.successes === 0 ? "-" : `${row.score}`;
                return (
                  <div key={row.base} className="rounded-md bg-surface-container px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold break-all">{row.base}</p>
                      <span
                        className={`text-[11px] px-2 py-1 rounded ${
                          row.consecutiveFailures >= 3 ? "bg-tertiary/20 text-tertiary" : "bg-primary/20 text-primary"
                        }`}
                      >
                        {t("systemCommand.score")}: {scoreLabel}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-on-surface-variant">
                      <span>
                        {t("systemCommand.avgLatency")}: {latencyLabel}
                      </span>
                      <span>
                        OK/ERR: {row.successes}/{row.failures}
                      </span>
                      <span>
                        {t("systemCommand.cooldownUntil")}:{" "}
                        {row.cooldownUntil ? new Date(row.cooldownUntil).toLocaleTimeString(localeTag) : t("systemCommand.noCooldown")}
                      </span>
                    </div>
                    <div className="mt-2">
                      <p className="text-[10px] uppercase text-on-surface-variant mb-1">{t("systemCommand.latencyTrend")}</p>
                      <div className="flex items-end gap-1 h-8">
                        {(row.latencySamples.length > 0 ? row.latencySamples : [0]).map((sample, idx, arr) => {
                          const max = Math.max(...arr, 1);
                          const height = Math.max(2, Math.round((sample / max) * 28));
                          return (
                            <span
                              key={`${row.base}-lat-${idx}`}
                              className={`w-2 rounded-sm ${
                                row.consecutiveFailures >= 3 ? "bg-tertiary/70" : "bg-primary/70"
                              }`}
                              style={{ height }}
                              title={`${sample} ms`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-lg bg-surface-container-low p-4 space-y-3">
          <p className="text-xs text-on-surface-variant uppercase">{t("systemCommand.performanceTitle")}</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <div className="rounded-md bg-surface-container px-3 py-2">
              <p className="text-[10px] text-on-surface-variant uppercase">{t("systemCommand.winRate")}</p>
              <p className="text-sm font-black">{performance?.winRatePercent?.toFixed(2) ?? "0.00"}%</p>
            </div>
            <div className="rounded-md bg-surface-container px-3 py-2">
              <p className="text-[10px] text-on-surface-variant uppercase">{t("systemCommand.closedTrades")}</p>
              <p className="text-sm font-black">{performance?.closedTrades ?? 0}</p>
            </div>
            <div className="rounded-md bg-surface-container px-3 py-2">
              <p className="text-[10px] text-on-surface-variant uppercase">{t("systemCommand.avgHoldSec")}</p>
              <p className="text-sm font-black">{performance?.avgHoldSec ?? 0}</p>
            </div>
            <div className="rounded-md bg-surface-container px-3 py-2">
              <p className="text-[10px] text-on-surface-variant uppercase">{t("systemCommand.netPnl")}</p>
              <p className="text-sm font-black">{performance?.netPnl?.toFixed(2) ?? "0.00"}</p>
            </div>
            <div className="rounded-md bg-surface-container px-3 py-2">
              <p className="text-[10px] text-on-surface-variant uppercase">{t("systemCommand.maxDrawdown")}</p>
              <p className="text-sm font-black">{performance?.maxDrawdown?.toFixed(2) ?? "0.00"}</p>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] text-on-surface-variant uppercase">{t("systemCommand.modelHitRates")}</p>
            <div className="rounded-md bg-surface-container px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold">{t("systemCommand.adaptivePolicy")}</span>
              <span className="text-on-surface-variant">
                {t("systemCommand.minConfidence")}: {performance?.adaptive?.minConfidence ?? 0}% |{" "}
                {t("systemCommand.unanimous")}: {performance?.adaptive?.requireUnanimous ? "ON" : "OFF"} |{" "}
                {t("systemCommand.strictness")}: {performance?.adaptive?.strictness ?? "-"}
              </span>
            </div>
            {performance?.adaptive?.reasonData ? (
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span
                  className={`rounded px-2 py-1 ${
                    performance.adaptive.reasonData.winRatePercent < 55
                      ? "bg-tertiary/20 text-tertiary"
                      : "bg-secondary/20 text-secondary"
                  }`}
                >
                  WR: {performance.adaptive.reasonData.winRatePercent.toFixed(2)}%
                </span>
                <span
                  className={`rounded px-2 py-1 ${
                    performance.adaptive.reasonData.maxDrawdown > 8
                      ? "bg-tertiary/20 text-tertiary"
                      : "bg-primary/20 text-primary"
                  }`}
                >
                  DD: {performance.adaptive.reasonData.maxDrawdown.toFixed(2)}
                </span>
                <span
                  className={`rounded px-2 py-1 ${
                    performance.adaptive.reasonData.deltaConfidence > 0
                      ? "bg-tertiary/20 text-tertiary"
                      : performance.adaptive.reasonData.deltaConfidence < 0
                        ? "bg-secondary/20 text-secondary"
                        : "bg-surface-container-high text-on-surface-variant"
                  }`}
                >
                  Conf Delta: {performance.adaptive.reasonData.deltaConfidence >= 0 ? "+" : ""}
                  {performance.adaptive.reasonData.deltaConfidence}
                </span>
              </div>
            ) : null}
            <div className="rounded-md bg-surface-container px-3 py-2 text-xs">
              <span className="font-bold mr-2">{t("systemCommand.policyReason")}:</span>
              <span className="text-on-surface-variant">{performance?.adaptive?.reason ?? "-"}</span>
            </div>
            {(performance?.modelHitRates?.length ?? 0) === 0 ? (
              <p className="text-xs text-on-surface-variant">{t("systemCommand.noModelStats")}</p>
            ) : (
              performance!.modelHitRates.map((row) => (
                <div key={row.model} className="rounded-md bg-surface-container px-3 py-2 flex items-center justify-between text-xs">
                  <span className="font-bold">{row.model}</span>
                  <span className="text-on-surface-variant">
                    {row.hitRatePercent.toFixed(2)}% ({row.samples})
                  </span>
                </div>
              ))
            )}
          </div>
          {/* Neden: Risk kontrollu optimizasyonun etkisini operatorun canli gormesi icin rule/coin/time metrikleri eklendi. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <div className="rounded-md bg-surface-container px-3 py-2 text-xs space-y-2">
              <p className="font-bold uppercase text-[10px] text-on-surface-variant">Coin Basari Orani</p>
              {(performance?.coinHitRates?.length ?? 0) === 0 ? (
                <p className="text-on-surface-variant">Veri yok</p>
              ) : (
                performance!.coinHitRates!.slice(0, 6).map((row) => (
                  <div key={row.symbol} className="flex items-center justify-between">
                    <span className="font-semibold">{row.symbol}</span>
                    <span className="text-on-surface-variant">
                      {row.hitRatePercent.toFixed(1)}% ({row.samples}) | pnl {row.netPnl.toFixed(2)}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="rounded-md bg-surface-container px-3 py-2 text-xs space-y-2">
              <p className="font-bold uppercase text-[10px] text-on-surface-variant">Saat Bazli Basari</p>
              {(performance?.timeBucketHitRates?.length ?? 0) === 0 ? (
                <p className="text-on-surface-variant">Veri yok</p>
              ) : (
                performance!.timeBucketHitRates!.slice(0, 6).map((row) => (
                  <div key={row.bucket} className="flex items-center justify-between">
                    <span className="font-semibold">{row.bucket}</span>
                    <span className="text-on-surface-variant">{row.hitRatePercent.toFixed(1)}% ({row.samples})</span>
                  </div>
                ))
              )}
            </div>
            <div className="rounded-md bg-surface-container px-3 py-2 text-xs space-y-2">
              <p className="font-bold uppercase text-[10px] text-on-surface-variant">En Cok Kazandiran Kurallar</p>
              {(performance?.bestRules?.length ?? 0) === 0 ? (
                <p className="text-on-surface-variant">Veri yok</p>
              ) : (
                performance!.bestRules!.slice(0, 5).map((row) => (
                  <div key={row.rule} className="flex items-center justify-between">
                    <span className="font-semibold">{row.rule}</span>
                    <span className="text-on-surface-variant">
                      pnl {row.netPnl.toFixed(2)} | W/L {row.wins}/{row.losses}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="rounded-md bg-surface-container px-3 py-2 text-xs space-y-2">
              <p className="font-bold uppercase text-[10px] text-on-surface-variant">En Cok Zarar Senaryolari</p>
              {(performance?.worstScenarios?.length ?? 0) === 0 ? (
                <p className="text-on-surface-variant">Veri yok</p>
              ) : (
                performance!.worstScenarios!.slice(0, 5).map((row) => (
                  <div key={row.scenario} className="flex items-center justify-between">
                    <span className="font-semibold">{row.scenario}</span>
                    <span className="text-on-surface-variant">
                      pnl {row.netPnl.toFixed(2)} | loss {row.losses}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="rounded-md bg-surface-container px-3 py-2 text-xs space-y-1">
            <p className="font-bold uppercase text-[10px] text-on-surface-variant">Optimizasyon Onerileri</p>
            {(performance?.strategyRecommendations?.length ?? 0) === 0 ? (
              <p className="text-on-surface-variant">Veri yok</p>
            ) : (
              performance!.strategyRecommendations!.map((row, index) => (
                <p key={`${row}-${index}`} className="text-on-surface-variant">{index + 1}. {row}</p>
              ))
            )}
          </div>
          <div className="space-y-2">
            <p className="text-[10px] text-on-surface-variant uppercase">{t("systemCommand.policyTimeline")}</p>
            <div className="flex items-end gap-1 h-10">
              {((performance?.timeline?.length ?? 0) > 0 ? performance?.timeline : [{ at: "", minConfidence: 0, requireUnanimous: false, closedTrades: 0, winRatePercent: 0, strictness: "normal" as const }])!.slice(-18).map((row, idx, arr) => {
                const max = Math.max(...arr.map((x) => x.minConfidence), 1);
                const height = Math.max(2, Math.round((row.minConfidence / max) * 36));
                return (
                  <span
                    key={`${row.at}-${idx}`}
                    className={`w-2 rounded-sm ${
                      row.strictness === "very_strict"
                        ? "bg-tertiary/70"
                        : row.strictness === "strict"
                          ? "bg-primary/70"
                          : "bg-secondary/70"
                    }`}
                    style={{ height }}
                    title={`${row.at ? new Date(row.at).toLocaleTimeString(localeTag) : "-"} | conf=${row.minConfidence} | ${row.strictness}`}
                  />
                );
              })}
            </div>
            {performance?.timeline?.length ? (
              <div className="max-h-36 overflow-y-auto space-y-1">
                {performance.timeline.slice(-6).reverse().map((row, idx) => (
                  <div
                    key={`${row.at}-${idx}`}
                    className={`rounded-md px-3 py-2 text-[11px] ${
                      row.strictness === "very_strict"
                        ? "bg-tertiary/15"
                        : row.strictness === "strict"
                          ? "bg-primary/15"
                          : "bg-surface-container"
                    }`}
                  >
                    <p className="font-bold">
                      {new Date(row.at).toLocaleTimeString(localeTag)} - {row.strictness}
                    </p>
                    <p className="text-on-surface-variant">{row.reason}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="rounded-lg bg-surface-container-low p-4 space-y-3">
          <p className="text-xs text-on-surface-variant uppercase">Failsafe / Safe Mode</p>
          <div className="rounded-md bg-surface-container px-3 py-2 text-xs flex items-center justify-between gap-2">
            <span className="font-semibold">Durum</span>
            <span className={health?.safeMode?.enabled ? "text-tertiary font-black" : "text-secondary font-black"}>
              {health?.safeMode?.enabled ? "SAFE MODE ACTIVE" : "NORMAL"}
            </span>
          </div>
          {health?.safeMode?.reason ? (
            <p className="text-xs text-on-surface-variant break-all">{health.safeMode.reason}</p>
          ) : null}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  await apiPost("/api/failsafe/safe-mode", {
                    enabled: true,
                    reason: "Manual safety lock by admin panel",
                    requireManualAck: true,
                  });
                  push("Safe mode aktif edildi", "error");
                } catch (error) {
                  push((error as Error).message, "error");
                }
              }}
              className="rounded bg-tertiary/20 px-3 py-2 text-xs font-black text-tertiary"
            >
              Safe Mode Ac
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await apiPost("/api/failsafe/safe-mode", {
                    enabled: false,
                    reason: "Manual ack completed",
                    requireManualAck: false,
                  });
                  push("Safe mode kapatildi", "success");
                } catch (error) {
                  push((error as Error).message, "error");
                }
              }}
              className="rounded bg-secondary/20 px-3 py-2 text-xs font-black text-secondary"
            >
              Safe Mode Kapat
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await apiPost("/api/failsafe/recovery", {});
                  push("Recovery senkronizasyonu tamamlandi", "success");
                } catch (error) {
                  push((error as Error).message, "error");
                }
              }}
              className="rounded bg-primary/20 px-3 py-2 text-xs font-black text-primary md:col-span-2"
            >
              Recovery Senkronizasyonu Calistir
            </button>
          </div>
        </div>
        <div className="rounded-lg bg-surface-container-low p-4 space-y-3">
          <p className="text-xs text-on-surface-variant uppercase">Monitoring Snapshot</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded-md bg-surface-container px-3 py-2">Acik Pozisyon: {monitoring?.activeOpenPositions ?? 0}</div>
            <div className="rounded-md bg-surface-container px-3 py-2">Bekleyen Emir: {monitoring?.pendingOrders ?? 0}</div>
            <div className="rounded-md bg-surface-container px-3 py-2">Basarisiz Emir: {monitoring?.failedOrders ?? 0}</div>
            <div className="rounded-md bg-surface-container px-3 py-2">API Hata Orani: %{monitoring?.apiErrorRatePercent ?? 0}</div>
            <div className="rounded-md bg-surface-container px-3 py-2">24s Islem: {monitoring?.tradesLast24h ?? 0}</div>
            <div className="rounded-md bg-surface-container px-3 py-2">Worker: {monitoring?.workerHealth.status ?? "-"}</div>
            <div className="rounded-md bg-surface-container px-3 py-2">Queue Backlog: {monitoring?.queueBacklog ?? 0}</div>
            <div className="rounded-md bg-surface-container px-3 py-2">
              Son Analiz:{" "}
              {monitoring?.lastSuccessfulAnalysisAt
                ? new Date(monitoring.lastSuccessfulAnalysisAt).toLocaleTimeString(localeTag)
                : "-"}
            </div>
          </div>
          <div className="rounded-md bg-surface-container px-3 py-2 text-xs">
            <p className="font-bold">Kritik Alarmlar</p>
            {(monitoring?.criticalAlarms?.length ?? 0) === 0
              ? <p className="text-on-surface-variant">Alarm yok</p>
              : monitoring!.criticalAlarms.map((x) => <p key={x} className="text-tertiary">{x}</p>)}
          </div>
        </div>
        <div className="rounded-lg bg-surface-container-low p-4 space-y-3">
          <p className="text-xs text-on-surface-variant uppercase">Audit Log</p>
          <div className="max-h-56 overflow-y-auto space-y-1 text-xs">
            {auditRows.length === 0 ? (
              <p className="text-on-surface-variant">Audit kaydi yok</p>
            ) : (
              auditRows.map((row) => (
                <div key={row.id} className="rounded-md bg-surface-container px-3 py-2 flex items-center justify-between gap-3">
                  <span className="font-semibold">{row.action}</span>
                  <span>{row.entityType}</span>
                  <span className="text-on-surface-variant">{row.user?.username ?? row.user?.email ?? "-"}</span>
                  <span className="text-on-surface-variant">{new Date(row.createdAt).toLocaleTimeString(localeTag)}</span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="rounded-lg bg-surface-container-low p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-xs text-on-surface-variant uppercase">{authCardTitle}</p>
              <span
                className={`rounded px-2 py-1 text-[10px] font-bold ${
                  authProvider === "okx"
                    ? "bg-primary/20 text-primary"
                    : authProvider === "binance"
                      ? "bg-secondary/20 text-secondary"
                      : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                {authProvider === "okx" ? "OKX" : authProvider === "binance" ? "BINANCE TR" : "AUTO"}
              </span>
            </div>
            <button
              type="button"
              onClick={runAuthCheck}
              className="rounded bg-surface-container px-2 py-1 text-[11px] font-bold hover:bg-surface-container-high"
              disabled={authCheckBusy}
            >
              Test Et
            </button>
          </div>
          <p className="text-xs text-on-surface-variant">{authCardDesc}</p>
          <div className="rounded-md bg-surface-container px-3 py-2 text-xs">
            <p className="font-semibold">Durum: {authCheck ? (authCheck.ok ? "OK" : "FAILED") : "-"}</p>
            <p className="text-on-surface-variant">
              {authCheck?.checkedAt ? new Date(authCheck.checkedAt).toLocaleTimeString(localeTag) : "-"}
            </p>
          </div>
          <div className="space-y-1">
            <div className="rounded-md bg-surface-container px-3 py-2 text-xs">
              <p className="font-semibold">Account Read: {authCheck?.accountRead?.ok ? "OK" : "-"}</p>
              <p className="text-on-surface-variant break-all">{authCheck?.accountRead?.endpoint ?? "-"}</p>
              <p className="text-on-surface-variant break-all">
                code={authCheck?.accountRead?.code ?? "-"} status={authCheck?.accountRead?.statusCode ?? "-"} msg={authCheck?.accountRead?.message ?? "-"}
              </p>
              <p className="text-on-surface-variant break-all">
                canTrade={authCheck?.accountRead?.flags?.canTrade ?? "-"} | canWithdraw={authCheck?.accountRead?.flags?.canWithdraw ?? "-"} | canDeposit={authCheck?.accountRead?.flags?.canDeposit ?? "-"}
              </p>
            </div>
            <div className="rounded-md bg-surface-container px-3 py-2 text-xs">
              <p className="font-semibold">Order Permission: {authCheck?.tradePermission?.ok ? "OK" : "-"}</p>
              <p className="text-on-surface-variant break-all">{authCheck?.tradePermission?.endpoint ?? "-"}</p>
              <p className="text-on-surface-variant break-all">
                code={authCheck?.tradePermission?.code ?? "-"} status={authCheck?.tradePermission?.statusCode ?? "-"} msg={authCheck?.tradePermission?.message ?? "-"}
              </p>
            </div>
            {authCheck?.diagnostics ? (
              <div className="rounded-md bg-surface-container px-3 py-2 text-xs space-y-1">
                <p className="font-semibold">Credential Diagnostics (safe)</p>
                <p className="text-on-surface-variant break-all">
                  key={authCheck.diagnostics.keyFingerprint ?? "-"} | env={authCheck.diagnostics.env} | pid={authCheck.diagnostics.pid}
                </p>
                <p className="text-on-surface-variant break-all">
                  keyLen={authCheck.diagnostics.keyLength} | secretLen={authCheck.diagnostics.secretLength}
                </p>
                <p className="text-on-surface-variant break-all">
                  keyWhitespace={authCheck.diagnostics.keyEdgeWhitespace ? "yes" : "no"} | secretWhitespace=
                  {authCheck.diagnostics.secretEdgeWhitespace ? "yes" : "no"}
                </p>
                <p className="text-on-surface-variant break-all">
                  serverBootedAt={new Date(authCheck.diagnostics.serverBootedAt).toLocaleString(localeTag)}
                </p>
                {authCheck.diagnostics.apiRestrictions ? (
                  <>
                    <p className="text-on-surface-variant break-all">
                      apiRestrictions: src={authCheck.diagnostics.apiRestrictions.source} code=
                      {authCheck.diagnostics.apiRestrictions.code ?? "-"} status=
                      {authCheck.diagnostics.apiRestrictions.statusCode ?? "-"}
                    </p>
                    <p className="text-on-surface-variant break-all">
                      spotTrade=
                      {authCheck.diagnostics.apiRestrictions.flags.enableSpotAndMarginTrading === null
                        ? "-"
                        : authCheck.diagnostics.apiRestrictions.flags.enableSpotAndMarginTrading
                          ? "true"
                          : "false"}{" "}
                      | read=
                      {authCheck.diagnostics.apiRestrictions.flags.enableReading === null
                        ? "-"
                        : authCheck.diagnostics.apiRestrictions.flags.enableReading
                          ? "true"
                          : "false"}{" "}
                      | withdraw=
                      {authCheck.diagnostics.apiRestrictions.flags.enableWithdrawals === null
                        ? "-"
                        : authCheck.diagnostics.apiRestrictions.flags.enableWithdrawals
                          ? "true"
                          : "false"}{" "}
                      | ipRestrict=
                      {authCheck.diagnostics.apiRestrictions.flags.ipRestrict === null
                        ? "-"
                        : authCheck.diagnostics.apiRestrictions.flags.ipRestrict
                          ? "true"
                          : "false"}
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          {authCheck?.reason ? (
            <p className="text-xs text-on-surface-variant break-all">{authCheck.reason}</p>
          ) : null}
          {authCheck?.hint ? (
            <p className="text-xs text-primary break-all">{authCheck.hint}</p>
          ) : null}
          {(authCheck?.actions?.length ?? 0) > 0 ? (
            <div className="space-y-1">
              {authCheck!.actions!.map((step, idx) => (
                <p key={`auth-action-${idx}`} className="text-[11px] text-on-surface-variant">
                  {idx + 1}. {step}
                </p>
              ))}
            </div>
          ) : null}
        </div>
        <div className="rounded-lg bg-surface-container-low p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-xs text-on-surface-variant uppercase">{connectivityCardTitle}</p>
              <span
                className={`rounded px-2 py-1 text-[10px] font-bold ${
                  connectivity?.provider === "okx"
                    ? "bg-primary/20 text-primary"
                    : connectivity?.provider === "binance"
                      ? "bg-secondary/20 text-secondary"
                      : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                {connectivity?.provider === "okx"
                  ? "OKX"
                  : connectivity?.provider === "binance"
                    ? "BINANCE TR"
                    : "AUTO"}
              </span>
            </div>
            <button
              type="button"
              onClick={async () => {
                setConnectivityBusy(true);
                try {
                  const data = await apiGet<{
                    status: "healthy" | "degraded" | "down";
                    okCount: number;
                    total: number;
                    provider: "binance" | "okx";
                    exchangeEnv: "live" | "testnet";
                    checkedAt: string;
                    checks: Array<{
                      id: string;
                      label: string;
                      url: string;
                      ok: boolean;
                      statusCode: number | null;
                      latencyMs: number;
                      error: string | null;
                      checkedAt: string;
                    }>;
                  }>("/api/health/connectivity");
                  setConnectivity(data);
                } catch (error) {
                  push((error as Error).message, "error");
                } finally {
                  setConnectivityBusy(false);
                }
              }}
              className="rounded bg-surface-container px-2 py-1 text-[11px] font-bold hover:bg-surface-container-high"
              disabled={connectivityBusy}
            >
              {t("systemCommand.checkNow")}
            </button>
          </div>
          <p className="text-xs text-on-surface-variant">{connectivityCardDesc}</p>
          <div className="rounded-md bg-surface-container px-3 py-2 text-xs flex items-center justify-between gap-2">
            <span>
              {connectivity ? `${connectivity.okCount}/${connectivity.total} OK` : "-"} | {connectivityPlatformLabel} env:{" "}
              <span className="font-bold">{connectivity?.exchangeEnv ?? "-"}</span>
            </span>
            <span className={`rounded px-2 py-1 font-bold ${connectivityStatusClass}`}>{connectivityStatusLabel}</span>
          </div>
          <div className="space-y-1">
            {(connectivity?.checks ?? []).map((row) => (
              <div key={row.id} className="rounded-md bg-surface-container px-3 py-2 text-xs flex items-center justify-between gap-2">
                <span className="font-semibold">{row.label}</span>
                <span className={row.ok ? "text-secondary" : "text-tertiary"}>
                  {row.ok ? `OK (${row.latencyMs}ms)` : row.error ?? `HTTP ${row.statusCode ?? "-"} `}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-on-surface-variant">
            {t("systemCommand.lastCheck")}:{" "}
            {connectivity?.checkedAt ? new Date(connectivity.checkedAt).toLocaleTimeString(localeTag) : "-"}
          </p>
        </div>
        <div className="rounded-lg bg-surface-container-low p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-on-surface-variant uppercase">Whitelist IP Check</p>
            <button
              type="button"
              onClick={async () => {
                setPublicIpBusy(true);
                try {
                  const data = await apiGet<{
                    ip: string | null;
                    source: "header" | "outbound" | "unknown";
                    hint: string | null;
                    checkedAt: string;
                  }>("/api/network/public-ip");
                  setPublicIp(data);
                } catch (error) {
                  push((error as Error).message, "error");
                } finally {
                  setPublicIpBusy(false);
                }
              }}
              className="rounded bg-surface-container px-2 py-1 text-[11px] font-bold hover:bg-surface-container-high"
              disabled={publicIpBusy}
            >
              IP Yenile
            </button>
          </div>
          <p className="text-xs text-on-surface-variant">
            Binance TR whitelist&apos;e eklenecek sunucu public IP bilgisini gosterir.
          </p>
          <div className="rounded-md bg-surface-container px-3 py-2 text-xs flex items-center justify-between gap-2">
            <span className="font-semibold break-all">{publicIp?.ip ?? "-"}</span>
            <span
              className={`rounded px-2 py-1 font-bold ${
                publicIp?.source === "header"
                  ? "bg-secondary/20 text-secondary"
                  : publicIp?.source === "outbound"
                    ? "bg-primary/20 text-primary"
                    : "bg-tertiary/20 text-tertiary"
              }`}
            >
              {publicIp?.source ?? "unknown"}
            </span>
          </div>
          {publicIp?.hint ? <p className="text-[11px] text-on-surface-variant break-all">{publicIp.hint}</p> : null}
          <p className="text-[11px] text-on-surface-variant">
            Son Kontrol: {publicIp?.checkedAt ? new Date(publicIp.checkedAt).toLocaleTimeString(localeTag) : "-"}
          </p>
        </div>
        <div className="rounded-lg bg-surface-container-low p-4 space-y-3">
          <p className="text-xs text-on-surface-variant uppercase">{t("systemCommand.aiCostTitle")}</p>
          <p className="text-xs text-on-surface-variant">{t("systemCommand.aiCostDesc")}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label className="rounded-md bg-surface-container px-3 py-2 text-xs">
              <span className="text-on-surface-variant">{t("systemCommand.dailyTrades")}</span>
              <input
                type="number"
                min={0}
                value={dailyTrades}
                onChange={(e) => setDailyTrades(Math.max(0, Number(e.target.value || 0)))}
                className="mt-1 w-full rounded bg-surface-container-high px-2 py-1 text-sm font-bold outline-none"
              />
            </label>
            <label className="rounded-md bg-surface-container px-3 py-2 text-xs">
              <span className="text-on-surface-variant">{t("systemCommand.profile")}</span>
              <select
                value={costProfile}
                onChange={(e) => setCostProfile(e.target.value as CostProfileKey)}
                className="mt-1 w-full rounded bg-surface-container-high px-2 py-1 text-sm font-bold outline-none"
              >
                <option value="light">{t("systemCommand.profileLight")}</option>
                <option value="medium">{t("systemCommand.profileMedium")}</option>
                <option value="heavy">{t("systemCommand.profileHeavy")}</option>
              </select>
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={resetCostDefaults}
              className="rounded bg-surface-container px-3 py-1 text-xs font-bold text-on-surface-variant hover:bg-surface-container-high"
            >
              {t("systemCommand.resetCostDefaults")}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-on-surface-variant">
                  <th className="text-left font-semibold py-1">Provider</th>
                  <th className="text-right font-semibold py-1">{t("systemCommand.weeklyCost")}</th>
                  <th className="text-right font-semibold py-1">{t("systemCommand.monthlyCost")}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-outline-variant/20">
                  <td className="py-1 font-semibold">OpenAI</td>
                  <td className="py-1 text-right">${weekly.openai.toFixed(2)}</td>
                  <td className="py-1 text-right">${monthly.openai.toFixed(2)}</td>
                </tr>
                <tr className="border-t border-outline-variant/20">
                  <td className="py-1 font-semibold">Claude</td>
                  <td className="py-1 text-right">${weekly.claude.toFixed(2)}</td>
                  <td className="py-1 text-right">${monthly.claude.toFixed(2)}</td>
                </tr>
                <tr className="border-t border-outline-variant/20">
                  <td className="py-1 font-semibold">Gemini</td>
                  <td className="py-1 text-right">${weekly.gemini.toFixed(2)}</td>
                  <td className="py-1 text-right">${monthly.gemini.toFixed(2)}</td>
                </tr>
                <tr className="border-t border-outline-variant/30">
                  <td className="py-1 font-black">{t("systemCommand.total")}</td>
                  <td className="py-1 text-right font-black">${weeklyTotal.toFixed(2)}</td>
                  <td className="py-1 text-right font-black">${monthlyTotal.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="rounded-md bg-surface-container px-3 py-3 space-y-3">
            <p className="text-[11px] font-bold uppercase text-on-surface-variant">{t("systemCommand.tokenCostTitle")}</p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <label className="text-xs">
                <span className="text-on-surface-variant">{t("systemCommand.avgTokensPerTrade")}</span>
                <input
                  type="number"
                  min={0}
                  value={avgTokensPerTrade}
                  onChange={(e) => setAvgTokensPerTrade(Math.max(0, Number(e.target.value || 0)))}
                  className="mt-1 w-full rounded bg-surface-container-high px-2 py-1 text-sm font-bold outline-none"
                />
              </label>
              <label className="text-xs">
                <span className="text-on-surface-variant">OpenAI {t("systemCommand.usdPer1kToken")}</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={usdPer1kOpenai}
                  onChange={(e) => setUsdPer1kOpenai(Math.max(0, Number(e.target.value || 0)))}
                  className="mt-1 w-full rounded bg-surface-container-high px-2 py-1 text-sm font-bold outline-none"
                />
              </label>
              <label className="text-xs">
                <span className="text-on-surface-variant">Claude {t("systemCommand.usdPer1kToken")}</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={usdPer1kClaude}
                  onChange={(e) => setUsdPer1kClaude(Math.max(0, Number(e.target.value || 0)))}
                  className="mt-1 w-full rounded bg-surface-container-high px-2 py-1 text-sm font-bold outline-none"
                />
              </label>
              <label className="text-xs">
                <span className="text-on-surface-variant">Gemini {t("systemCommand.usdPer1kToken")}</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={usdPer1kGemini}
                  onChange={(e) => setUsdPer1kGemini(Math.max(0, Number(e.target.value || 0)))}
                  className="mt-1 w-full rounded bg-surface-container-high px-2 py-1 text-sm font-bold outline-none"
                />
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-surface-container-high px-3 py-2">
                <span className="text-on-surface-variant">{t("systemCommand.tokenBasedWeekly")}:</span>{" "}
                <span className="font-black">${tokenWeeklyTotal.toFixed(2)}</span>
              </div>
              <div className="rounded bg-surface-container-high px-3 py-2">
                <span className="text-on-surface-variant">{t("systemCommand.tokenBasedMonthly")}:</span>{" "}
                <span className="font-black">${tokenMonthlyTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <button
            disabled={busy}
            onClick={() => emergencyStop(true)}
            className="rounded-lg bg-linear-to-br from-tertiary to-primary-container px-4 py-2 text-sm font-black text-[#002e6a] disabled:opacity-60"
          >
            {t("systemCommand.emergencyStop")}
          </button>
          <button
            disabled={busy}
            onClick={() => emergencyStop(false)}
            className="rounded-lg bg-surface-container px-4 py-2 text-sm font-bold hover:bg-surface-container-high disabled:opacity-60"
          >
            {t("systemCommand.resumeTrading")}
          </button>
        </div>
      </div>
    </div>
  );
}
