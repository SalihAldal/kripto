"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/client-api";
import type { AutoRoundStatusResponse, BacktestRunResult, PaperTradingReport } from "@/src/types/platform";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatPnl(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

type RoundRun = AutoRoundStatusResponse["jobs"][number]["rounds"][number];

const ROUND_HISTORY_PAGE_SIZE = 5;
type ProfessionalBacktestTrade = {
  symbol: string;
  laneTag?: string;
  entryTime: number;
  exitTime: number;
  holdSec?: number;
  netPnl: number;
  returnPercent: number;
  exitReason: string;
  outcome?: string;
  entryGateReason?: string;
};

type ProfessionalBacktestResult = {
  metrics: {
    tradeCount: number;
    wins: number;
    losses: number;
    winrate: number;
    totalPnl: number;
    endingBalance: number;
    sharpeRatio: number;
    maxDrawdown: number;
    expectancy: number;
    profitFactor: number;
  };
  strategyResults: Array<{
    strategy: string;
    metrics: ProfessionalBacktestResult["metrics"];
    trades?: ProfessionalBacktestTrade[];
    diagnostics?: {
      barsScanned?: number;
      candidateScans?: number;
      gatePasses?: number;
      gateRejections?: Array<{ reason: string; count: number }>;
      rejectionSamples?: Array<{ symbol: string; time: number; laneTag: string; reason: string }>;
      exitReasonBreakdown?: Array<{ reason: string; count: number }>;
    };
  }>;
  diagnostics?: {
    mode?: string;
    dataSource?: string;
    note?: string;
    totalTrades?: number;
    primaryStrategy?: string;
    barsScanned?: number;
    candidateScans?: number;
    gatePasses?: number;
    gatePassRatePercent?: number;
    cooldownRejections?: number;
    gateRejections?: Array<{ reason: string; count: number }>;
    exitReasonBreakdown?: Array<{ reason: string; count: number }>;
    rejectionSamples?: Array<{ symbol: string; time: number; laneTag: string; reason: string }>;
    trades?: ProfessionalBacktestTrade[];
  };
  config?: {
    mode?: string;
    dataSource?: string;
    maxWaitSec?: number;
    symbols?: string[];
  };
};

function formatBacktestTime(ts: number) {
  if (!Number.isFinite(ts) || ts <= 0) return "-";
  return new Date(ts).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ROUND_MAX_WAIT_OPTIONS = [
  { label: "15 dk", value: 900 },
  { label: "30 dk", value: 1800 },
  { label: "1 saat", value: 3600 },
  { label: "4 saat", value: 14_400 },
  { label: "12 saat", value: 43_200 },
  { label: "24 saat", value: 86_400 },
];

function readRunMetadata(run: RoundRun): Record<string, unknown> {
  const metadata = (run as unknown as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return {};
  return metadata as Record<string, unknown>;
}

function formatCountdown(totalSec: number) {
  const sec = Math.max(0, Math.floor(totalSec));
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}s ${m}dk`;
  }
  return `${min}dk ${rem}sn`;
}

function buildPageNumbers(current: number, total: number, maxVisible = 7) {
  if (total <= 1) return [1];
  if (total <= maxVisible) return Array.from({ length: total }, (_, i) => i + 1);
  let start = Math.max(1, current - Math.floor(maxVisible / 2));
  let end = start + maxVisible - 1;
  if (end > total) {
    end = total;
    start = Math.max(1, end - maxVisible + 1);
  }
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export default function SimulationLabPage() {
  const [paper, setPaper] = useState<PaperTradingReport | null>(null);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [result, setResult] = useState<BacktestRunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [roundLoading, setRoundLoading] = useState(false);
  const [roundStarting, setRoundStarting] = useState(false);
  const [roundStopping, setRoundStopping] = useState(false);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [closingRunId, setClosingRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roundStatus, setRoundStatus] = useState<AutoRoundStatusResponse | null>(null);
  const [roundHistoryPage, setRoundHistoryPage] = useState(1);
  const [roundHistoryFilter, setRoundHistoryFilter] = useState<"all" | "opened" | "rejected">("all");
  const [roundHistoryJobId, setRoundHistoryJobId] = useState("");
  const manualJobPickRef = useRef(false);
  const lastActiveJobIdRef = useRef<string | null>(null);
  const [professionalBacktest, setProfessionalBacktest] = useState<ProfessionalBacktestResult | null>(null);
  const [professionalRunning, setProfessionalRunning] = useState(false);

  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [symbols, setSymbols] = useState("BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,ADAUSDT,DOGEUSDT");
  const [strategy, setStrategy] = useState<"balanced" | "aggressive" | "conservative">("balanced");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [scanUniverseSize, setScanUniverseSize] = useState(100);
  const [forceSimulatedFills, setForceSimulatedFills] = useState(true);
  const [tpList, setTpList] = useState("1.2,1.8,2.4");
  const [slList, setSlList] = useState("0.8,1.2");
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [trailingStartPercent, setTrailingStartPercent] = useState(2.2);
  const [trailingGapPercent, setTrailingGapPercent] = useState(0.8);
  const [roundTotal, setRoundTotal] = useState(3);
  const [roundBudgetTry, setRoundBudgetTry] = useState(2000);
  const [roundTp, setRoundTp] = useState(2.4);
  const [roundSl, setRoundSl] = useState(1.0);
  const [roundMaxWaitSec, setRoundMaxWaitSec] = useState(900);
  const [roundAllowRepeatCoin, setRoundAllowRepeatCoin] = useState(true);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [paperData, backtestData] = await Promise.all([
        apiGet<PaperTradingReport>("/api/simulation/paper"),
        apiGet<{ history: Array<Record<string, unknown>> }>("/api/simulation/backtest"),
      ]);
      setPaper(paperData);
      setHistory(backtestData.history ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadRoundStatus = async () => {
    setRoundLoading(true);
    try {
      const data = await apiGet<AutoRoundStatusResponse>("/api/trades/rounds/status");
      setRoundStatus(data);
    } catch {
      // Round API bazen auth/rate limit sebebiyle hata verebilir; ana sayfa deneyimini bozma.
    } finally {
      setRoundLoading(false);
    }
  };

  const effectiveRoundJobId = useMemo(() => {
    if (roundHistoryJobId) return roundHistoryJobId;
    return roundStatus?.active?.id ?? roundStatus?.summary?.recentJobs?.[0]?.jobId ?? "";
  }, [roundHistoryJobId, roundStatus?.active?.id, roundStatus?.summary?.recentJobs]);

  const selectedRoundJob = useMemo(() => {
    const jobs = roundStatus?.jobs ?? [];
    if (!jobs.length) return null;
    return jobs.find((job) => job.id === effectiveRoundJobId) ?? jobs[0] ?? null;
  }, [roundStatus?.jobs, effectiveRoundJobId]);

  const selectedJobSummary = useMemo(() => {
    const jobs = roundStatus?.summary?.recentJobs ?? [];
    if (!jobs.length) return null;
    return jobs.find((job) => job.jobId === effectiveRoundJobId) ?? jobs[0] ?? null;
  }, [roundStatus?.summary?.recentJobs, effectiveRoundJobId]);

  const roundRunCounts = useMemo(() => {
    const runs = selectedRoundJob?.rounds ?? [];
    const windowOpened = runs.filter((run) => Number(run.buyPrice ?? 0) > 0 && Number(run.buyQty ?? 0) > 0).length;
    const windowRejected = runs.filter((run) => run.state === "tur_basarisiz").length;
    const summary = selectedJobSummary;
    return {
      all: summary ? summary.openedRounds + summary.rejectedCount : runs.length,
      opened: summary?.openedRounds ?? windowOpened,
      rejected: summary?.rejectedCount ?? windowRejected,
      loaded: runs.length,
    };
  }, [selectedRoundJob?.rounds, selectedJobSummary]);

  const filteredRoundRuns = useMemo(() => {
    const runs = [...(selectedRoundJob?.rounds ?? [])].sort((a, b) => b.roundNo - a.roundNo);
    if (roundHistoryFilter === "opened") {
      return runs.filter((run) => Number(run.buyPrice ?? 0) > 0 && Number(run.buyQty ?? 0) > 0);
    }
    if (roundHistoryFilter === "rejected") {
      return runs.filter((run) => run.state === "tur_basarisiz");
    }
    return runs;
  }, [selectedRoundJob?.rounds, roundHistoryFilter]);

  const roundHistoryTotalPages = Math.max(1, Math.ceil(filteredRoundRuns.length / ROUND_HISTORY_PAGE_SIZE));

  const paginatedRoundRuns = useMemo(() => {
    const start = (roundHistoryPage - 1) * ROUND_HISTORY_PAGE_SIZE;
    return filteredRoundRuns.slice(start, start + ROUND_HISTORY_PAGE_SIZE);
  }, [filteredRoundRuns, roundHistoryPage]);

  useEffect(() => {
    void loadAll();
    void loadRoundStatus();
  }, []);

  useEffect(() => {
    const activeId = roundStatus?.active?.id ?? null;
    if (activeId && activeId !== lastActiveJobIdRef.current) {
      lastActiveJobIdRef.current = activeId;
      manualJobPickRef.current = false;
      setRoundHistoryJobId(activeId);
      setRoundHistoryPage(1);
      setRoundHistoryFilter("all");
      return;
    }
    if (!roundHistoryJobId) {
      const fallbackId = activeId ?? roundStatus?.summary?.recentJobs?.[0]?.jobId ?? "";
      if (fallbackId) setRoundHistoryJobId(fallbackId);
    }
  }, [roundStatus?.active?.id, roundStatus?.summary?.recentJobs, roundHistoryJobId]);

  useEffect(() => {
    if (roundHistoryPage > roundHistoryTotalPages) {
      setRoundHistoryPage(roundHistoryTotalPages);
    }
  }, [roundHistoryPage, roundHistoryTotalPages]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadRoundStatus();
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const parsedSymbols = useMemo(
    () =>
      symbols
        .split(",")
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean),
    [symbols],
  );
  const activeRoundLatestRun = roundStatus?.active?.rounds?.[0] ?? null;

  const deleteRoundRun = async (runId: string) => {
    if (!runId) return;
    setDeletingRunId(runId);
    setError(null);
    try {
      await apiPost(
        "/api/trades/rounds/run/delete",
        { runId },
        {
          "x-idempotency-key":
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `round-run-delete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
      );
      await loadRoundStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingRunId(null);
    }
  };

  const forceCloseRun = async (run: RoundRun) => {
    const meta = readRunMetadata(run);
    const positionId = String(meta.positionId ?? "");
    if (!positionId) {
      setError("Bu tur kaydinda positionId yok, manuel kapatma yapilamiyor.");
      return;
    }
    setClosingRunId(run.id);
    setError(null);
    try {
      await apiPost(
        "/api/trades/close",
        { positionId },
        {
          "x-idempotency-key":
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `round-force-close-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
      );
      await loadRoundStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setClosingRunId(null);
    }
  };

  const runBacktest = async () => {
    setRunning(true);
    setError(null);
    try {
      const payload = {
        startDate,
        endDate,
        symbols: parsedSymbols,
        strategy,
        aiEnabled,
        scanUniverseSize,
        forceSimulatedFills,
        intervalMinutes,
        trailingStartPercent,
        trailingGapPercent,
        tpPercents: tpList
          .split(",")
          .map((x) => Number(x.trim()))
          .filter((x) => Number.isFinite(x) && x > 0),
        slPercents: slList
          .split(",")
          .map((x) => Number(x.trim()))
          .filter((x) => Number.isFinite(x) && x > 0),
      };
      const next = await apiPost<BacktestRunResult>("/api/simulation/backtest", payload, {
        "x-confirm-action": "CONFIRM",
      });
      setResult(next);
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const runProfessionalBacktest = async () => {
    setProfessionalRunning(true);
    setError(null);
    try {
      const next = await apiPost<ProfessionalBacktestResult>("/api/trading-core/backtest", {
        mode: "paper-round",
        symbols: parsedSymbols.slice(0, 8),
        initialBalance: 10000,
        positionSizePercent: 12,
        takeProfitPercent: 0.88,
        stopLossPercent: 0.55,
        maxWaitSec: Math.max(900, Math.floor(roundMaxWaitSec || 3600)),
        klineInterval: "1m",
        klineLimit: 1000,
        strategies: ["steady-gain", "pump-lane", "paper-round"],
        takerFeeRate: 0.0015,
        slippageBps: 8,
      });
      setProfessionalBacktest(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProfessionalRunning(false);
    }
  };

  const resetPaper = async () => {
    setError(null);
    try {
      await apiPost("/api/simulation/paper/reset", {}, { "x-confirm-action": "CONFIRM" });
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const startPaperRoundEngine = async () => {
    setRoundStarting(true);
    setError(null);
    try {
      await apiPost(
        "/api/trades/rounds/start",
        {
          totalRounds: Math.max(1, Math.min(500, Math.floor(roundTotal))),
          budgetPerTrade: Math.max(100, roundBudgetTry),
          targetProfitPct: Math.max(0.2, Math.min(500, roundTp)),
          stopLossPct: Math.max(0.2, Math.min(600, roundSl)),
          maxWaitSec: Math.max(60, Math.floor(roundMaxWaitSec)),
          coinSelectionMode: "scanner_best",
          aiMode: "learning",
          allowRepeatCoin: roundAllowRepeatCoin,
          mode: "auto",
        },
        {
          "x-idempotency-key":
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `round-start-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
      );
      await Promise.all([loadRoundStatus(), loadAll()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRoundStarting(false);
    }
  };

  const stopPaperRoundEngine = async () => {
    setRoundStopping(true);
    setError(null);
    try {
      await apiPost(
        "/api/trades/rounds/stop",
        {},
        {
          "x-idempotency-key":
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `round-stop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
      );
      await loadRoundStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRoundStopping(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Backtest & Paper Trading Lab</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Gercek karar motorunu bozmadan, execution katmani simulation ile calisir. Live kodla ortak akis korunur.
        </p>
      </div>

      {error ? <div className="rounded-lg bg-tertiary/15 p-3 text-sm text-tertiary">{error}</div> : null}
      {loading ? <div className="rounded-lg bg-surface-container-low p-3 text-sm">Yukleniyor...</div> : null}

      <section className="rounded-xl bg-surface-container-low p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-black">Paper Trading Hesabi</h2>
          <button
            type="button"
            onClick={resetPaper}
            className="rounded-md bg-tertiary/20 px-3 py-1.5 text-xs font-bold text-tertiary"
          >
            Sanal Bakiyeyi Sifirla
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
          {Object.entries(paper?.balances ?? {})
            .slice(0, 10)
            .map(([asset, amount]) => (
              <div key={asset} className="rounded-md bg-surface-container px-3 py-2">
                <p className="text-on-surface-variant">{asset}</p>
                <p className="font-black">{Number(amount).toFixed(6)}</p>
              </div>
            ))}
        </div>
        <p className="text-xs text-on-surface-variant">Sanal emir sayisi: {paper?.orderCount ?? 0}</p>
      </section>

      <section className="rounded-xl bg-surface-container-low p-4 space-y-3">
        <h2 className="text-lg font-black">Backtest Calistir</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <label className="text-xs">
            Baslangic
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 w-full rounded bg-surface-container px-2 py-2"
            />
          </label>
          <label className="text-xs">
            Bitis
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 w-full rounded bg-surface-container px-2 py-2"
            />
          </label>
          <label className="text-xs">
            Strateji
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as "balanced" | "aggressive" | "conservative")}
              className="mt-1 w-full rounded bg-surface-container px-2 py-2"
            >
              <option value="balanced">Balanced</option>
              <option value="aggressive">Aggressive</option>
              <option value="conservative">Conservative</option>
            </select>
          </label>
          <label className="md:col-span-3 text-xs">
            Coin Listesi (seed) - sistem bunu 100 coine kadar genisletir
            <input
              value={symbols}
              onChange={(e) => setSymbols(e.target.value)}
              className="mt-1 w-full rounded bg-surface-container px-2 py-2"
              placeholder="BTCUSDT,ETHUSDT,SOLUSDT"
            />
          </label>
          <label className="text-xs">
            Taranacak coin adedi
            <input
              type="number"
              min={20}
              max={300}
              value={scanUniverseSize}
              onChange={(e) => setScanUniverseSize(Number(e.target.value) || 100)}
              className="mt-1 w-full rounded bg-surface-container px-2 py-2"
            />
          </label>
          <label className="text-xs">
            Zaman periyodu (dk)
            <input
              type="number"
              min={1}
              max={240}
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value) || 1)}
              className="mt-1 w-full rounded bg-surface-container px-2 py-2"
            />
          </label>
          <label className="text-xs">
            TP varyasyonlari
            <input
              value={tpList}
              onChange={(e) => setTpList(e.target.value)}
              className="mt-1 w-full rounded bg-surface-container px-2 py-2"
              placeholder="1.2,1.8,2.4"
            />
          </label>
          <label className="text-xs">
            SL varyasyonlari
            <input
              value={slList}
              onChange={(e) => setSlList(e.target.value)}
              className="mt-1 w-full rounded bg-surface-container px-2 py-2"
              placeholder="0.8,1.2"
            />
          </label>
          <label className="text-xs">
            Trailing start (%)
            <input
              type="number"
              min={0}
              max={50}
              step="0.1"
              value={trailingStartPercent}
              onChange={(e) => setTrailingStartPercent(Number(e.target.value) || 0)}
              className="mt-1 w-full rounded bg-surface-container px-2 py-2"
            />
          </label>
          <label className="text-xs">
            Trailing gap (%)
            <input
              type="number"
              min={0}
              max={50}
              step="0.1"
              value={trailingGapPercent}
              onChange={(e) => setTrailingGapPercent(Number(e.target.value) || 0)}
              className="mt-1 w-full rounded bg-surface-container px-2 py-2"
            />
          </label>
          <label className="text-xs flex items-center gap-2 mt-6">
            <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
            AI bazli test aktif
          </label>
          <label className="text-xs flex items-center gap-2 mt-6">
            <input
              type="checkbox"
              checked={forceSimulatedFills}
              onChange={(e) => setForceSimulatedFills(e.target.checked)}
            />
            Sinyal gelmeyen coinlerde simule alim-satim uret
          </label>
        </div>
        <button
          type="button"
          onClick={runBacktest}
          disabled={running}
          className="rounded-md bg-primary px-4 py-2 text-sm font-black text-black disabled:opacity-60"
        >
          {running ? "Backtest calisiyor..." : "Backtest Baslat"}
        </button>
      </section>

      <section className="rounded-xl bg-surface-container-low p-4 space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-black">Paper Round Backtest</h2>
            <p className="text-xs text-on-surface-variant">
              Gercek Binance kline + auto-round paper gate/exit kurallari. Canli tur motoru ile ayni mantik.
            </p>
          </div>
          <button
            type="button"
            onClick={runProfessionalBacktest}
            disabled={professionalRunning}
            className="rounded-md bg-primary px-4 py-2 text-sm font-black text-black disabled:opacity-60"
          >
            {professionalRunning ? "Paper round backtest calisiyor..." : "Paper Round Backtest Baslat"}
          </button>
        </div>

        {professionalBacktest ? (
          <div className="space-y-3">
            {professionalBacktest.diagnostics?.note ? (
              <p className="text-xs text-on-surface-variant rounded bg-surface-container px-3 py-2">
                {professionalBacktest.diagnostics.dataSource === "real-klines" ? "Veri: gercek kline · " : ""}
                {professionalBacktest.diagnostics.note}
              </p>
            ) : null}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
              <div className="rounded bg-surface-container px-3 py-2">
                <p className="text-on-surface-variant">Net PnL</p>
                <p className={`font-black ${professionalBacktest.metrics.totalPnl >= 0 ? "text-secondary" : "text-tertiary"}`}>
                  {formatPnl(professionalBacktest.metrics.totalPnl)}
                </p>
              </div>
              <div className="rounded bg-surface-container px-3 py-2">
                <p className="text-on-surface-variant">Winrate</p>
                <p className="font-black">%{professionalBacktest.metrics.winrate.toFixed(2)}</p>
              </div>
              <div className="rounded bg-surface-container px-3 py-2">
                <p className="text-on-surface-variant">Sharpe</p>
                <p className="font-black">{professionalBacktest.metrics.sharpeRatio.toFixed(4)}</p>
              </div>
              <div className="rounded bg-surface-container px-3 py-2">
                <p className="text-on-surface-variant">Max Drawdown</p>
                <p className="font-black text-tertiary">%{professionalBacktest.metrics.maxDrawdown.toFixed(2)}</p>
              </div>
              <div className="rounded bg-surface-container px-3 py-2">
                <p className="text-on-surface-variant">Expectancy</p>
                <p className="font-black">{professionalBacktest.metrics.expectancy.toFixed(4)}</p>
              </div>
              <div className="rounded bg-surface-container px-3 py-2">
                <p className="text-on-surface-variant">Profit Factor</p>
                <p className="font-black">{professionalBacktest.metrics.profitFactor.toFixed(4)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
              {professionalBacktest.strategyResults.map((row) => (
                <div key={row.strategy} className="rounded bg-surface-container px-3 py-2">
                  <p className="font-black">{row.strategy}</p>
                  <p className="text-on-surface-variant">
                    PnL: {formatPnl(row.metrics.totalPnl)} · Winrate: %{row.metrics.winrate.toFixed(2)}
                  </p>
                  <p className="text-on-surface-variant">
                    Sharpe: {row.metrics.sharpeRatio.toFixed(3)} · PF: {row.metrics.profitFactor.toFixed(3)}
                  </p>
                  {row.diagnostics ? (
                    <p className="text-on-surface-variant mt-1">
                      Gate pass: {row.diagnostics.gatePasses ?? 0} / scan: {row.diagnostics.candidateScans ?? 0}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>

            {professionalBacktest.diagnostics?.gatePasses !== undefined ? (
              <p className="text-xs text-on-surface-variant rounded bg-surface-container px-3 py-2">
                Gate pass: {professionalBacktest.diagnostics.gatePasses} / {professionalBacktest.diagnostics.candidateScans ?? 0}
                {professionalBacktest.diagnostics.gatePassRatePercent !== undefined
                  ? ` (%${professionalBacktest.diagnostics.gatePassRatePercent.toFixed(2)})`
                  : ""}
                {professionalBacktest.diagnostics.cooldownRejections
                  ? ` · Cooldown red: ${professionalBacktest.diagnostics.cooldownRejections} (coin 2x kaybedince tekrar deneme)`
                  : ""}
              </p>
            ) : null}

            {professionalBacktest.diagnostics?.gateRejections &&
            professionalBacktest.diagnostics.gateRejections.length > 0 ? (
              <div className="rounded bg-surface-container px-3 py-3 space-y-2">
                <p className="text-sm font-black">Kalite gate redleri (cooldown haric)</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  {professionalBacktest.diagnostics.gateRejections.map((row) => (
                    <div key={row.reason} className="flex items-center justify-between rounded bg-surface-container-low px-2 py-1.5">
                      <span className="text-on-surface-variant truncate pr-2">{row.reason}</span>
                      <span className="font-black shrink-0">{row.count}</span>
                    </div>
                  ))}
                </div>
                {professionalBacktest.diagnostics.rejectionSamples &&
                professionalBacktest.diagnostics.rejectionSamples.length > 0 ? (
                  <div className="space-y-1 pt-1">
                    <p className="text-[11px] font-bold text-on-surface-variant">Ornek redler</p>
                    {professionalBacktest.diagnostics.rejectionSamples.slice(0, 6).map((row, index) => (
                      <p key={`${row.symbol}-${row.time}-${index}`} className="text-[11px] text-on-surface-variant">
                        {row.symbol} · {formatBacktestTime(row.time)} · {row.laneTag} · {row.reason}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {professionalBacktest.diagnostics?.exitReasonBreakdown &&
            professionalBacktest.diagnostics.exitReasonBreakdown.length > 0 ? (
              <div className="rounded bg-surface-container px-3 py-3 space-y-2">
                <p className="text-sm font-black">Cikis sebepleri</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  {professionalBacktest.diagnostics.exitReasonBreakdown.map((row) => (
                    <span key={row.reason} className="rounded bg-surface-container-low px-2 py-1">
                      {row.reason}: <strong>{row.count}</strong>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {professionalBacktest.diagnostics?.trades && professionalBacktest.diagnostics.trades.length > 0 ? (
              <div className="rounded bg-surface-container px-3 py-3 space-y-2 overflow-x-auto">
                <p className="text-sm font-black">Islem listesi (paper-round)</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-on-surface-variant">
                      <th className="py-1 pr-2">Coin</th>
                      <th className="py-1 pr-2">Lane</th>
                      <th className="py-1 pr-2">Giris</th>
                      <th className="py-1 pr-2">Sure</th>
                      <th className="py-1 pr-2">PnL</th>
                      <th className="py-1 pr-2">ROE</th>
                      <th className="py-1 pr-2">Cikis</th>
                      <th className="py-1">Sonuc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {professionalBacktest.diagnostics.trades.map((trade, index) => (
                      <tr key={`${trade.symbol}-${trade.entryTime}-${index}`} className="border-t border-outline-variant/20">
                        <td className="py-1.5 pr-2 font-bold">{trade.symbol}</td>
                        <td className="py-1.5 pr-2">{trade.laneTag ?? "-"}</td>
                        <td className="py-1.5 pr-2">{formatBacktestTime(trade.entryTime)}</td>
                        <td className="py-1.5 pr-2">{trade.holdSec ?? 0}s</td>
                        <td className={`py-1.5 pr-2 font-bold ${trade.netPnl >= 0 ? "text-secondary" : "text-tertiary"}`}>
                          {formatPnl(trade.netPnl)}
                        </td>
                        <td className={`py-1.5 pr-2 ${trade.returnPercent >= 0 ? "text-secondary" : "text-tertiary"}`}>
                          {formatPercent(trade.returnPercent)}
                        </td>
                        <td className="py-1.5 pr-2">{trade.exitReason}</td>
                        <td className="py-1.5 uppercase font-bold">{trade.outcome ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {result ? (
        <section className="rounded-xl bg-surface-container-low p-4 space-y-3">
          <h2 className="text-lg font-black">Backtest Sonucu</h2>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
            <div className="rounded bg-surface-container px-3 py-2">
              <p className="text-on-surface-variant">Toplam PnL</p>
              <p className={`font-black ${result.metrics.totalPnl >= 0 ? "text-secondary" : "text-tertiary"}`}>
                {formatPnl(result.metrics.totalPnl)}
              </p>
              <p className={`text-[11px] font-bold ${result.metrics.totalPnlPercent >= 0 ? "text-secondary" : "text-tertiary"}`}>
                {formatPercent(result.metrics.totalPnlPercent)}
              </p>
            </div>
            <div className="rounded bg-surface-container px-3 py-2">
              <p className="text-on-surface-variant">Win Rate</p>
              <p className="font-black">%{result.metrics.winRate.toFixed(2)}</p>
            </div>
            <div className="rounded bg-surface-container px-3 py-2">
              <p className="text-on-surface-variant">Max Drawdown</p>
              <p className="font-black text-tertiary">{result.metrics.maxDrawdown.toFixed(4)}</p>
            </div>
            <div className="rounded bg-surface-container px-3 py-2">
              <p className="text-on-surface-variant">Ortalama Islem Suresi</p>
              <p className="font-black">{result.metrics.avgHoldSec}s</p>
            </div>
            <div className="rounded bg-surface-container px-3 py-2">
              <p className="text-on-surface-variant">Kazanc / Kayip</p>
              <p className="font-black">
                {result.metrics.wins}/{result.metrics.losses}
              </p>
            </div>
            <div className="rounded bg-surface-container px-3 py-2">
              <p className="text-on-surface-variant">Toplam Islem</p>
              <p className="font-black">{result.metrics.tradeCount}</p>
            </div>
            <div className="rounded bg-surface-container px-3 py-2">
              <p className="text-on-surface-variant">Taranan Coin</p>
              <p className="font-black">{result.scannedSymbols.length}</p>
            </div>
            <div className="rounded bg-surface-container px-3 py-2">
              <p className="text-on-surface-variant">Simule Doldurma</p>
              <p className="font-black">{result.simulatedFillCount}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <div className="rounded bg-surface-container px-3 py-2">
              <p className="text-on-surface-variant">En Iyi Islem</p>
              {result.metrics.bestTrade ? (
                <p className="font-black">
                  {result.metrics.bestTrade.symbol} · {formatPnl(result.metrics.bestTrade.netPnl)} · {result.metrics.bestTrade.holdSec}s
                </p>
              ) : (
                <p className="font-black">-</p>
              )}
            </div>
            <div className="rounded bg-surface-container px-3 py-2">
              <p className="text-on-surface-variant">En Kotu Islem</p>
              {result.metrics.worstTrade ? (
                <p className="font-black">
                  {result.metrics.worstTrade.symbol} · {formatPnl(result.metrics.worstTrade.netPnl)} · {result.metrics.worstTrade.holdSec}s
                </p>
              ) : (
                <p className="font-black">-</p>
              )}
            </div>
          </div>

          <div className="rounded bg-surface-container p-3 text-xs">
            <p className="font-bold mb-2">Son Simule Al/Sat Islemleri</p>
            <div className="space-y-1">
              {result.trades.slice(0, 20).map((trade, idx) => (
                <div key={`${trade.symbol}-${trade.openedAt}-${idx}`} className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{trade.symbol}</span>
                  <span>Alis {trade.entryPrice.toFixed(6)}</span>
                  <span>Satis {trade.exitPrice.toFixed(6)}</span>
                  <span className={trade.pnlPercent >= 0 ? "text-secondary" : "text-tertiary"}>
                    %{trade.pnlPercent.toFixed(2)}
                  </span>
                  <span className="text-on-surface-variant">
                    {trade.simulatedFill ? "simule" : trade.exitReason}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="rounded bg-surface-container p-3">
              <p className="font-bold mb-2">En Iyi Coinler</p>
              {result.metrics.bestCoins.map((row) => (
                <p key={row.symbol}>
                  {row.symbol} - {formatPnl(row.pnl)} ({row.count})
                </p>
              ))}
            </div>
            <div className="rounded bg-surface-container p-3">
              <p className="font-bold mb-2">En Kotu Coinler</p>
              {result.metrics.worstCoins.map((row) => (
                <p key={row.symbol}>
                  {row.symbol} - {formatPnl(row.pnl)} ({row.count})
                </p>
              ))}
            </div>
          </div>

          <div className="rounded bg-surface-container p-3 text-xs">
            <p className="font-bold mb-2">Strateji Karsilastirmasi (TP/SL varyasyon)</p>
            <div className="space-y-1">
              {result.strategyComparison.slice(0, 10).map((row) => (
                <div key={row.key} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{row.key}</span>
                  <span className={row.totalPnl >= 0 ? "text-secondary" : "text-tertiary"}>
                    {formatPnl(row.totalPnl)} ({formatPercent(row.totalPnlPercent)})
                  </span>
                  <span>%{row.winRate.toFixed(1)}</span>
                  <span>DD {row.maxDrawdown.toFixed(3)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded bg-surface-container p-3 text-xs">
            <p className="font-bold mb-2">Ornek Test Senaryolari</p>
            {result.sampleScenarios.map((row) => (
              <p key={row.label}>
                {row.label}: strateji={row.strategy}, ai={row.aiEnabled ? "on" : "off"}, tp={row.tpPercents.join("/")}, sl=
                {row.slPercents.join("/")}
              </p>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl bg-surface-container-low p-4 text-xs">
        <h2 className="text-lg font-black mb-2">Backtest Gecmisi</h2>
        {history.length === 0 ? <p className="text-on-surface-variant">Kayit yok.</p> : null}
        <div className="space-y-1">
          {history.slice(0, 8).map((row) => (
            <div key={String(row.id ?? Math.random())} className="rounded bg-surface-container px-3 py-2">
              <p className="font-semibold">{String(row.id ?? "-")}</p>
              <p className="text-on-surface-variant">
                {String((row.range as { start?: string } | undefined)?.start ?? "-")} -{" "}
                {String((row.range as { end?: string } | undefined)?.end ?? "-")}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-surface-container-low p-4 space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-black">Canli Paper Tur Motoru (Gercek Binance Veri)</h2>
            <p className="text-on-surface-variant">
              Analiz + alim/satim motoruyla ayni akisi kullanir. Mod paper oldugu icin gercek para harcanmaz.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={startPaperRoundEngine}
              disabled={roundStarting}
              className="rounded-md bg-primary px-3 py-1.5 font-bold text-black disabled:opacity-60"
            >
              {roundStarting ? "Baslatiliyor..." : "Paper Tur Baslat"}
            </button>
            <button
              type="button"
              onClick={stopPaperRoundEngine}
              disabled={roundStopping}
              className="rounded-md bg-tertiary/20 px-3 py-1.5 font-bold text-tertiary disabled:opacity-60"
            >
              {roundStopping ? "Durduruluyor..." : "Paper Tur Durdur"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <label>
            Tur adedi
            <input
              type="number"
              min={1}
              max={500}
              value={roundTotal}
              onChange={(e) => setRoundTotal(Number(e.target.value) || 1)}
              className="mt-1 w-full rounded bg-surface-container px-2 py-2"
            />
          </label>
          <label>
            Tur basi butce (TRY)
            <input
              type="number"
              min={100}
              value={roundBudgetTry}
              onChange={(e) => setRoundBudgetTry(Number(e.target.value) || 100)}
              className="mt-1 w-full rounded bg-surface-container px-2 py-2"
            />
          </label>
          <label>
            Hedef kar %
            <input
              type="number"
              step={0.1}
              min={0.2}
              max={500}
              value={roundTp}
              onChange={(e) => setRoundTp(Number(e.target.value) || 0.2)}
              className="mt-1 w-full rounded bg-surface-container px-2 py-2"
            />
          </label>
          <label>
            Stop loss %
            <input
              type="number"
              step={0.1}
              min={0.2}
              max={600}
              value={roundSl}
              onChange={(e) => setRoundSl(Number(e.target.value) || 0.2)}
              className="mt-1 w-full rounded bg-surface-container px-2 py-2"
            />
          </label>
          <label>
            Max bekleme
            <select
              value={roundMaxWaitSec}
              onChange={(e) => setRoundMaxWaitSec(Number(e.target.value) || 900)}
              className="mt-1 w-full rounded bg-surface-container px-2 py-2"
            >
              {ROUND_MAX_WAIT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 mt-6">
            <input
              type="checkbox"
              checked={roundAllowRepeatCoin}
              onChange={(e) => setRoundAllowRepeatCoin(e.target.checked)}
            />
            Ayni coin tekrar secilebilir
          </label>
        </div>

        <div className="rounded bg-surface-container p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-bold">Simulasyon Gecmisi Ozeti</p>
              <p className="text-on-surface-variant">
                Ust kart: son {roundStatus?.summary?.windowSize ?? 100} tur. Asagidaki job satiri: tum job gecmisi (DB).
              </p>
            </div>
            <span className="rounded bg-primary/15 px-2 py-1 font-bold text-primary">
              Winrate %{Number(roundStatus?.summary?.winRate ?? 0).toFixed(2)}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="rounded bg-surface-container-high p-2">
              <p className="text-on-surface-variant">Toplam Tur</p>
              <p className="text-lg font-black">{roundStatus?.summary?.totalRounds ?? 0}</p>
            </div>
            <div className="rounded bg-surface-container-high p-2">
              <p className="text-on-surface-variant">Islem Acildi</p>
              <p className="text-lg font-black">{roundStatus?.summary?.openedRounds ?? 0}</p>
            </div>
            <div className="rounded bg-surface-container-high p-2">
              <p className="text-on-surface-variant">Basarili</p>
              <p className="text-lg font-black text-primary">{roundStatus?.summary?.successCount ?? 0}</p>
            </div>
            <div className="rounded bg-surface-container-high p-2">
              <p className="text-on-surface-variant">Basarisiz</p>
              <p className="text-lg font-black text-tertiary">{roundStatus?.summary?.failedCount ?? 0}</p>
            </div>
            <div className="rounded bg-surface-container-high p-2">
              <p className="text-on-surface-variant">Acilmadan Red</p>
              <p className="text-lg font-black">{roundStatus?.summary?.rejectedCount ?? 0}</p>
            </div>
            <div className="rounded bg-surface-container-high p-2">
              <p className="text-on-surface-variant">Net Kar</p>
              <p className={`text-lg font-black ${Number(roundStatus?.summary?.netPnl ?? 0) >= 0 ? "text-primary" : "text-tertiary"}`}>
                {formatPnl(Number(roundStatus?.summary?.netPnl ?? 0))}
              </p>
              <p className={`text-[11px] font-bold ${Number(roundStatus?.summary?.netPnlPercent ?? 0) >= 0 ? "text-primary" : "text-tertiary"}`}>
                {formatPercent(Number(roundStatus?.summary?.netPnlPercent ?? 0))}
              </p>
            </div>
          </div>
          {roundStatus?.summary?.rejectionBuckets && Object.keys(roundStatus.summary.rejectionBuckets).length > 0 ? (
            <div className="rounded bg-surface-container-high p-2 space-y-2">
              <p className="font-bold">Red Dagilimi</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(roundStatus.summary.rejectionBuckets).map(([bucket, count]) => (
                  <div key={bucket} className="rounded bg-surface-container px-2 py-1">
                    <p className="text-on-surface-variant">{bucket}</p>
                    <p className="text-lg font-black">{count}</p>
                  </div>
                ))}
              </div>
              {roundStatus.summary.lastRejectSamples?.length ? (
                <div className="space-y-1">
                  <p className="font-bold">Son Red Ornekleri</p>
                  {roundStatus.summary.lastRejectSamples.slice(0, 4).map((item, idx) => (
                    <div key={`${item.at}-${idx}`} className="rounded bg-surface-container px-2 py-1 text-xs">
                      <span className="font-bold">{item.symbol || "-"}</span> | {item.bucket} | {item.reason || "-"}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {roundStatus?.summary?.exitReasonBuckets &&
          Object.keys(roundStatus.summary.exitReasonBuckets).length > 0 ? (
            <div className="rounded bg-surface-container-high p-2 space-y-2">
              <p className="font-bold">Cikis Sebepleri (son {roundStatus.summary.windowSize ?? 100} tur)</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(roundStatus.summary.exitReasonBuckets).map(([reason, count]) => (
                  <span key={reason} className="rounded bg-surface-container px-2 py-1">
                    {reason}: <strong>{count}</strong>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {roundStatus?.summary?.timeoutAnalysis && roundStatus.summary.timeoutAnalysis.count > 0 ? (
            <div className="rounded bg-surface-container-high p-2 space-y-2 overflow-x-auto">
              <p className="font-bold">
                TIMEOUT Analizi ({roundStatus.summary.timeoutAnalysis.count} islem)
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                {Object.entries(roundStatus.summary.timeoutAnalysis.byRegime).map(([regime, count]) => (
                  <span key={regime} className="rounded bg-surface-container px-2 py-1">
                    {regime}: <strong>{count}</strong>
                  </span>
                ))}
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-on-surface-variant">
                    <th className="py-1 pr-2">Coin</th>
                    <th className="py-1 pr-2">Lane</th>
                    <th className="py-1 pr-2">Rejim</th>
                    <th className="py-1 pr-2">MTF</th>
                    <th className="py-1 pr-2">Sure</th>
                    <th className="py-1 pr-2">ROE</th>
                  </tr>
                </thead>
                <tbody>
                  {roundStatus.summary.timeoutAnalysis.trades.map((trade, idx) => (
                    <tr key={`${trade.symbol}-${trade.openedAt}-${idx}`} className="border-t border-outline-variant/20">
                      <td className="py-1 pr-2 font-bold">{trade.symbol}</td>
                      <td className="py-1 pr-2">{trade.entryLane}</td>
                      <td className="py-1 pr-2">{trade.marketRegime}</td>
                      <td className="py-1 pr-2">{trade.mtfAlignment.toFixed(1)}</td>
                      <td className="py-1 pr-2">{trade.holdSec}s</td>
                      <td className={`py-1 pr-2 ${trade.roePercent >= 0 ? "text-secondary" : "text-tertiary"}`}>
                        {formatPercent(trade.roePercent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {roundStatus?.summary?.recentJobs?.length ? (
            <div className="space-y-2 rounded bg-surface-container-high p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">Son Toplu Turlar {roundLoading ? "(guncelleniyor...)" : ""}</p>
                <p className="text-[11px] text-on-surface-variant">
                  {filteredRoundRuns.length} kayit | Sayfa basina {ROUND_HISTORY_PAGE_SIZE}
                  {roundRunCounts.loaded < roundRunCounts.all
                    ? ` | yuklenen son ${roundRunCounts.loaded} tur`
                    : ""}
                </p>
              </div>

              <div className="flex flex-wrap gap-1">
                {roundStatus.summary.recentJobs.slice(0, 5).map((job) => (
                  <button
                    key={job.jobId}
                    type="button"
                    onClick={() => {
                      manualJobPickRef.current = true;
                      setRoundHistoryPage(1);
                      setRoundHistoryJobId(job.jobId);
                    }}
                    className={`rounded px-2 py-1 text-xs font-bold ${
                      effectiveRoundJobId === job.jobId ? "bg-secondary text-black" : "bg-surface-container px-2 py-1"
                    }`}
                  >
                    {job.totalRounds} tur ({job.status})
                  </button>
                ))}
              </div>

              {selectedJobSummary ? (
                <div className="flex flex-col gap-1 rounded bg-surface-container px-2 py-1">
                  <span>
                    Tur {selectedJobSummary.currentRound ?? selectedJobSummary.completedRounds}/{selectedJobSummary.totalRounds} |{" "}
                    {selectedJobSummary.status} | TUM: acilan {selectedJobSummary.openedRounds} | basarili{" "}
                    {selectedJobSummary.successCount} / basarisiz {selectedJobSummary.failedCount} / red{" "}
                    {selectedJobSummary.rejectedCount}
                  </span>
                  {selectedJobSummary.statsScope === "full" && (selectedJobSummary.windowRejectedCount ?? 0) > 0 ? (
                    <span className="text-on-surface-variant">
                      Son 100 tur penceresi: acilan {selectedJobSummary.windowOpenedRounds ?? 0} | basarili{" "}
                      {selectedJobSummary.windowSuccessCount ?? 0} / basarisiz {selectedJobSummary.windowFailedCount ?? 0} / red{" "}
                      {selectedJobSummary.windowRejectedCount ?? 0}
                    </span>
                  ) : null}
                  <span className={selectedJobSummary.netPnl >= 0 ? "font-bold text-primary" : "font-bold text-tertiary"}>
                    {formatPnl(selectedJobSummary.netPnl)} ({formatPercent(selectedJobSummary.netPnlPercent)}) | Winrate %
                    {selectedJobSummary.winRate.toFixed(2)}
                  </span>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ["opened", "Acilan", roundRunCounts.opened],
                    ["all", "Tumu", roundRunCounts.all],
                    ["rejected", "Red", roundRunCounts.rejected],
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setRoundHistoryPage(1);
                      setRoundHistoryFilter(key);
                    }}
                    className={`rounded px-2 py-1 text-xs font-bold ${
                      roundHistoryFilter === key
                        ? "bg-primary text-black"
                        : "bg-surface-container text-on-surface-variant"
                    }`}
                  >
                    {label} ({count})
                  </button>
                ))}
              </div>

              {paginatedRoundRuns.length ? (
                paginatedRoundRuns.map((run) => {
                  const meta = readRunMetadata(run);
                  const closeReason = String(meta.closeReason ?? "-");
                  const rejectBucket = String(meta.rejectBucket ?? "-");
                  const maxWaitSec = Number(meta.maxWaitSec ?? 0);
                  const expectedSellAtRaw =
                    String(meta.expectedSellAt ?? "") ||
                    new Date(new Date(run.startedAt).getTime() + Math.max(0, maxWaitSec) * 1000).toISOString();
                  const expectedSellAt = new Date(expectedSellAtRaw);
                  const remainSec = Math.max(0, Math.floor((expectedSellAt.getTime() - Date.now()) / 1000));
                  const canDelete =
                    run.state !== "satis_bekleniyor" &&
                    run.state !== "alim_yapildi" &&
                    run.state !== "coin_secildi" &&
                    run.state !== "tariyor";
                  const showPlan = run.state === "satis_bekleniyor" || run.state === "alim_yapildi";
                  const resultBadge =
                    run.result === "profit"
                      ? "text-primary"
                      : run.result === "loss"
                        ? "text-tertiary"
                        : run.state === "tur_basarisiz"
                          ? "text-on-surface-variant"
                          : "";
                  return (
                    <div key={run.id} className="rounded bg-surface-container px-2 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`font-semibold ${resultBadge}`}>
                          Tur #{run.roundNo} - {run.symbol ?? "NO_TRADE"} - {run.state}
                          {run.result ? ` (${run.result})` : ""}
                        </p>
                        <div className="flex items-center gap-1">
                          {run.state === "satis_bekleniyor" ? (
                            <button
                              type="button"
                              disabled={closingRunId === run.id}
                              onClick={() => void forceCloseRun(run)}
                              className="rounded bg-primary px-2 py-0.5 font-bold text-black disabled:opacity-50"
                              title="Pozisyonu hemen kapat"
                            >
                              {closingRunId === run.id ? "..." : "Hemen Sat"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={!canDelete || deletingRunId === run.id}
                            onClick={() => void deleteRoundRun(run.id)}
                            className="rounded bg-tertiary/20 px-2 py-0.5 font-black text-tertiary disabled:opacity-40"
                            title={canDelete ? "Bu turu sil" : "Aktif/ilerleyen tur silinemez"}
                          >
                            {deletingRunId === run.id ? "..." : "×"}
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-on-surface-variant">
                        {new Date(run.startedAt).toLocaleString("tr-TR")}
                        {run.endedAt ? ` → ${new Date(run.endedAt).toLocaleString("tr-TR")}` : ""}
                      </p>
                      {Number(run.buyPrice ?? 0) > 0 ? (
                        <p>
                          Alis: {Number(run.buyPrice ?? 0).toFixed(6)} | Satis: {Number(run.sellPrice ?? 0).toFixed(6)} |
                          Net PnL: {formatPnl(Number(run.netPnl ?? 0))}
                        </p>
                      ) : (
                        <p className="text-on-surface-variant">
                          Red nedeni: {run.failReason ?? run.selectedReason ?? "-"}
                        </p>
                      )}
                      {run.state === "tur_basarisiz" ? (
                        <p className="text-on-surface-variant">
                          Bucket: {rejectBucket} | Tarama: {String(meta.horizonProfile ?? "-")} | Max bekleme:{" "}
                          {maxWaitSec > 0 ? formatCountdown(maxWaitSec) : "-"}
                        </p>
                      ) : null}
                      {showPlan ? (
                        <>
                          <p className="text-on-surface-variant">
                            Plan: TP %{Number(meta.targetProfitPct ?? 0).toFixed(2)} | SL %{Number(meta.stopLossPct ?? 0).toFixed(2)} |
                            Max Bekleme {maxWaitSec > 0 ? formatCountdown(maxWaitSec) : "-"}
                          </p>
                          <p className="text-on-surface-variant">
                            Tahmini satis: {expectedSellAt.toLocaleTimeString("tr-TR")} ({formatCountdown(remainSec)} sonra)
                          </p>
                        </>
                      ) : null}
                      {run.state !== "tur_basarisiz" ? (
                        <p className="text-on-surface-variant">
                          Cikis: {closeReason} | Secim: {run.selectedReason ?? "-"}
                        </p>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <p className="text-on-surface-variant">Bu filtrede kayit yok.</p>
              )}

              {roundHistoryTotalPages > 1 ? (
                <div className="flex flex-wrap items-center justify-center gap-1 pt-1">
                  <button
                    type="button"
                    disabled={roundHistoryPage <= 1}
                    onClick={() => setRoundHistoryPage((p) => Math.max(1, p - 1))}
                    className="rounded bg-surface-container px-2 py-1 text-xs font-bold disabled:opacity-40"
                  >
                    ‹
                  </button>
                  {buildPageNumbers(roundHistoryPage, roundHistoryTotalPages).map((pageNo) => (
                    <button
                      key={pageNo}
                      type="button"
                      onClick={() => setRoundHistoryPage(pageNo)}
                      className={`min-w-8 rounded px-2 py-1 text-xs font-bold ${
                        roundHistoryPage === pageNo ? "bg-primary text-black" : "bg-surface-container"
                      }`}
                    >
                      {pageNo}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={roundHistoryPage >= roundHistoryTotalPages}
                    onClick={() => setRoundHistoryPage((p) => Math.min(roundHistoryTotalPages, p + 1))}
                    className="rounded bg-surface-container px-2 py-1 text-xs font-bold disabled:opacity-40"
                  >
                    ›
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="rounded bg-surface-container p-3 space-y-2">
          <p className="font-bold">Aktif Tur Durumu {roundLoading ? "(guncelleniyor...)" : ""}</p>
          {roundStatus?.active ? (
            <>
              {(() => {
                const run = activeRoundLatestRun;
                const meta = run ? readRunMetadata(run) : {};
                const maxWaitSec = Number(meta.maxWaitSec ?? roundStatus.active?.maxWaitSec ?? 0);
                const expectedSellAtRaw =
                  String(meta.expectedSellAt ?? "") || new Date(new Date(run?.startedAt ?? Date.now()).getTime() + Math.max(0, maxWaitSec) * 1000).toISOString();
                const expectedSellAt = new Date(expectedSellAtRaw);
                const remainSec = Math.max(0, Math.floor((expectedSellAt.getTime() - Date.now()) / 1000));
                const takeProfitPrice = Number(meta.takeProfitPrice ?? 0);
                const stopLossPrice = Number(meta.stopLossPrice ?? 0);
                const planReason = String(meta.planReason ?? run?.selectedReason ?? "-");
                return (
                  <>
                    <p className="text-on-surface-variant">
                      Plan: TP %{Number(meta.targetProfitPct ?? roundStatus.active?.targetProfitPct ?? 0).toFixed(2)} | SL %
                      {Number(meta.stopLossPct ?? roundStatus.active?.stopLossPct ?? 0).toFixed(2)} | TP fiyat{" "}
                      {takeProfitPrice > 0 ? takeProfitPrice.toFixed(6) : "-"} | SL fiyat{" "}
                      {stopLossPrice > 0 ? stopLossPrice.toFixed(6) : "-"}
                    </p>
                    <p className="text-on-surface-variant">
                      Tahmini satis: {expectedSellAt.toLocaleTimeString("tr-TR")} ({formatCountdown(remainSec)} sonra)
                    </p>
                    <p className="text-on-surface-variant">Plan nedeni: {planReason}</p>
                  </>
                );
              })()}
              <p>
                Durum: <span className="font-semibold">{roundStatus.active.activeState}</span> | Tur:{" "}
                {roundStatus.active.currentRound}/{roundStatus.active.totalRounds}
              </p>
              <p>
                Tamamlanan/Basarisiz: {roundStatus.active.completedRounds}/{roundStatus.active.failedRounds}
              </p>
              <p>
                TP/SL: %{roundStatus.active.targetProfitPct} / %{roundStatus.active.stopLossPct} | Max Bekleme:{" "}
                {roundStatus.active.maxWaitSec}s
              </p>
              <p className="text-on-surface-variant">
                Debug: lastError={roundStatus.active.lastError ?? "-"} | sonRun=
                {activeRoundLatestRun?.state ?? "-"} | failReason={activeRoundLatestRun?.failReason ?? "-"}
              </p>
              <p className="text-on-surface-variant">
                Debug: selectedReason={activeRoundLatestRun?.selectedReason ?? "-"} | executionId=
                {activeRoundLatestRun?.executionId ?? "-"}
              </p>
            </>
          ) : (
            <p className="text-on-surface-variant">Aktif tur yok.</p>
          )}
        </div>
      </section>
    </div>
  );
}
