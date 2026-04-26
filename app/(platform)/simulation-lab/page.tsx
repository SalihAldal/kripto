"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/client-api";
import type { BacktestRunResult, PaperTradingReport } from "@/src/types/platform";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatPnl(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
}

export default function SimulationLabPage() {
  const [paper, setPaper] = useState<PaperTradingReport | null>(null);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [result, setResult] = useState<BacktestRunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [symbols, setSymbols] = useState("BTCUSDT,ETHUSDT,SOLUSDT");
  const [strategy, setStrategy] = useState<"balanced" | "aggressive" | "conservative">("balanced");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [tpList, setTpList] = useState("1.2,1.8,2.4");
  const [slList, setSlList] = useState("0.8,1.2");

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

  useEffect(() => {
    void loadAll();
  }, []);

  const parsedSymbols = useMemo(
    () =>
      symbols
        .split(",")
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean),
    [symbols],
  );

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

  const resetPaper = async () => {
    setError(null);
    try {
      await apiPost("/api/simulation/paper/reset", {}, { "x-confirm-action": "CONFIRM" });
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
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
            Coin Listesi (virgul ile)
            <input
              value={symbols}
              onChange={(e) => setSymbols(e.target.value)}
              className="mt-1 w-full rounded bg-surface-container px-2 py-2"
              placeholder="BTCUSDT,ETHUSDT,SOLUSDT"
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
          <label className="text-xs flex items-center gap-2 mt-6">
            <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
            AI bazli test aktif
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

      {result ? (
        <section className="rounded-xl bg-surface-container-low p-4 space-y-3">
          <h2 className="text-lg font-black">Backtest Sonucu</h2>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
            <div className="rounded bg-surface-container px-3 py-2">
              <p className="text-on-surface-variant">Toplam PnL</p>
              <p className={`font-black ${result.metrics.totalPnl >= 0 ? "text-secondary" : "text-tertiary"}`}>
                {formatPnl(result.metrics.totalPnl)}
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
                  <span className={row.totalPnl >= 0 ? "text-secondary" : "text-tertiary"}>{formatPnl(row.totalPnl)}</span>
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
    </div>
  );
}
