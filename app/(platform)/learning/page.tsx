"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/client-api";

type LearningOverview = {
  tradeCount: number;
  patternCount: number;
  livePolicyCount: number;
  topPatterns: Array<Record<string, unknown>>;
  riskyPatterns: Array<Record<string, unknown>>;
  activePolicies: Array<Record<string, unknown>>;
  deepAnalysis?: {
    recent: Array<Record<string, unknown>>;
    rootCauseStats: Array<{ value: string; count: number }>;
    deepTagStats: Array<{ value: string; count: number }>;
    policyRecommendationStats: Array<{ value: string; count: number }>;
  };
  marketEvidence?: {
    recent: Array<Record<string, unknown>>;
  };
  aiAnalysisMemory?: {
    sampleCount: number;
    byHorizon: Array<{ horizon: string; count: number; winRate: number; avgReturn: number }>;
    reliable: Array<Record<string, unknown>>;
    risky: Array<Record<string, unknown>>;
    missedNoTrade: Array<Record<string, unknown>>;
    recent: Array<Record<string, unknown>>;
  };
  calibration?: LearningCalibration;
  updatedAt: string;
};

type LearningCalibration = {
  sampleCount: number;
  byRecommendation: Array<{ key: string; count: number; winrate: number; averageReturnPercent: number; avgConfidence?: number }>;
  tagCalibration: Array<{ key: string; count: number; winrate: number; averageReturnPercent: number }>;
};

function fmt(value: unknown, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(digits);
}

function Card(props: { title: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/3 p-5 shadow-sm">
      <p className="text-sm text-zinc-400">{props.title}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{props.value}</p>
      {props.note ? <p className="mt-1 text-xs text-zinc-500">{props.note}</p> : null}
    </div>
  );
}

export default function LearningPage() {
  const [overview, setOverview] = useState<LearningOverview | null>(null);
  const [calibration, setCalibration] = useState<LearningCalibration | null>(null);
  const [loading, setLoading] = useState(true);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [overviewData, calibrationData] = await Promise.all([
        apiGet<LearningOverview>("/api/trading-core/learning/overview"),
        apiGet<LearningCalibration>("/api/trading-core/learning/calibration"),
      ]);
      setOverview(overviewData);
      setCalibration(calibrationData);
      setMessage(null);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const strongestTags = useMemo(
    () => (calibration?.tagCalibration ?? []).slice(0, 8),
    [calibration],
  );

  const runBackfill = async () => {
    setBackfillRunning(true);
    setMessage(null);
    try {
      const result = await apiPost<{ processedCount: number }>("/api/trading-core/learning/backfill", { limit: 10 }, {
        "x-confirm-action": "CONFIRM",
      });
      setMessage(`Backfill tamamlandi: ${result.processedCount} trade islendi.`);
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBackfillRunning(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#08090d] px-6 py-8 text-zinc-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-linear-to-br from-zinc-950 to-zinc-900 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-orange-400">Learning Loop</p>
              <h1 className="mt-2 text-3xl font-semibold text-white">Trader Hafizasi ve Live Guard</h1>
              <p className="mt-2 max-w-3xl text-sm text-zinc-400">
                Simulation/paper trade hafizasi, deep post-trade analizleri, market evidence, policy patch ve AI kalibrasyonu tek ekranda.
              </p>
            </div>
            <button
              onClick={runBackfill}
              disabled={backfillRunning}
              className="rounded-xl bg-orange-500 px-5 py-3 text-sm font-semibold text-black transition hover:bg-orange-400 disabled:opacity-60"
            >
              {backfillRunning ? "Backfill calisiyor..." : "Eski Trade Backfill"}
            </button>
          </div>
          {message ? <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-orange-100">{message}</div> : null}
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <Card title="Learning Trade" value={loading ? "..." : String(overview?.tradeCount ?? 0)} />
          <Card title="Pattern" value={loading ? "..." : String(overview?.patternCount ?? 0)} />
          <Card title="Live Policy" value={loading ? "..." : String(overview?.livePolicyCount ?? 0)} note="Sim + live ortak policy havuzu" />
          <Card title="AI Memory Sample" value={loading ? "..." : String(overview?.aiAnalysisMemory?.sampleCount ?? 0)} note="Analiz + reject + trade sonucu" />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/3 p-5">
            <h2 className="text-lg font-semibold">Root Cause Haritasi</h2>
            <div className="mt-4 space-y-3">
              {(overview?.deepAnalysis?.rootCauseStats ?? []).slice(0, 8).map((row) => (
                <div key={row.value} className="rounded-xl bg-black/30 p-3">
                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span className="line-clamp-2 text-zinc-200">{row.value}</span>
                    <span className="rounded-lg bg-orange-500/15 px-2 py-1 text-orange-300">{row.count}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/3 p-5">
            <h2 className="text-lg font-semibold">AI Kalibrasyon</h2>
            <div className="mt-4 space-y-3">
              {(calibration?.byRecommendation ?? overview?.calibration?.byRecommendation ?? []).map((row) => (
                <div key={row.key} className="grid grid-cols-4 gap-2 rounded-xl bg-black/30 p-3 text-sm">
                  <span className="font-medium text-white">{row.key}</span>
                  <span className="text-zinc-400">n={row.count}</span>
                  <span className="text-zinc-400">WR {fmt(row.winrate)}%</span>
                  <span className={row.averageReturnPercent >= 0 ? "text-emerald-300" : "text-red-300"}>{fmt(row.averageReturnPercent, 4)}%</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/3 p-5">
            <h2 className="text-lg font-semibold">En Riskli Patternler</h2>
            <div className="mt-4 space-y-3">
              {(overview?.riskyPatterns ?? []).slice(0, 8).map((row, idx) => (
                <div key={`${row.patternKey}-${idx}`} className="rounded-xl bg-black/30 p-3 text-sm">
                  <p className="line-clamp-2 text-zinc-200">{String(row.patternKey ?? "-")}</p>
                  <p className="mt-1 text-red-300">DD {fmt(row.maxDrawdownPercent)}% | WR {fmt(row.winrate)}%</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/3 p-5">
            <h2 className="text-lg font-semibold">Market Evidence</h2>
            <div className="mt-4 space-y-3">
              {(overview?.marketEvidence?.recent ?? []).slice(0, 8).map((row, idx) => (
                <div key={`${row.tradeId}-${idx}`} className="rounded-xl bg-black/30 p-3 text-sm">
                  <p className="font-medium text-white">{String(row.symbol ?? "-")}</p>
                  <p className="mt-1 text-zinc-400">Funding {fmt(row.fundingRate, 6)} | OI {fmt(row.openInterest, 0)}</p>
                  <p className="text-zinc-400">Liq {fmt(row.liquidationImbalance, 3)} | News {String(row.newsSentiment ?? "-")}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/3 p-5">
            <h2 className="text-lg font-semibold">Tag Kalibrasyonu</h2>
            <div className="mt-4 space-y-3">
              {strongestTags.map((row) => (
                <div key={row.key} className="rounded-xl bg-black/30 p-3 text-sm">
                  <p className="text-zinc-200">{row.key}</p>
                  <p className="mt-1 text-zinc-400">n={row.count} | WR {fmt(row.winrate)}% | Avg {fmt(row.averageReturnPercent, 4)}%</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/3 p-5">
            <h2 className="text-lg font-semibold">AI Analiz Hafizasi</h2>
            <div className="mt-4 space-y-3">
              {(overview?.aiAnalysisMemory?.byHorizon ?? []).map((row) => (
                <div key={row.horizon} className="grid grid-cols-4 gap-2 rounded-xl bg-black/30 p-3 text-sm">
                  <span className="font-medium text-white">{row.horizon}</span>
                  <span className="text-zinc-400">n={row.count}</span>
                  <span className="text-zinc-400">WR {fmt(row.winRate)}%</span>
                  <span className={row.avgReturn >= 0 ? "text-emerald-300" : "text-red-300"}>{fmt(row.avgReturn, 4)}%</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/3 p-5">
            <h2 className="text-lg font-semibold">Guvenilir AI Patternleri</h2>
            <div className="mt-4 space-y-3">
              {(overview?.aiAnalysisMemory?.reliable ?? []).slice(0, 8).map((row, idx) => (
                <div key={`${row.patternKey}-${idx}`} className="rounded-xl bg-black/30 p-3 text-sm">
                  <p className="line-clamp-2 text-zinc-200">{String(row.patternKey ?? "-")}</p>
                  <p className="mt-1 text-zinc-400">
                    {String(row.decision ?? "-")} | n={String(row.sampleCount ?? 0)} | WR {fmt(row.winRate)}% | Avg {fmt(row.avgReturn, 4)}%
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/3 p-5">
            <h2 className="text-lg font-semibold">Yanilan / Kacan Analizler</h2>
            <div className="mt-4 space-y-3">
              {[...(overview?.aiAnalysisMemory?.risky ?? []), ...(overview?.aiAnalysisMemory?.missedNoTrade ?? [])].slice(0, 8).map((row, idx) => (
                <div key={`${row.patternKey}-${idx}`} className="rounded-xl bg-black/30 p-3 text-sm">
                  <p className="line-clamp-2 text-zinc-200">{String(row.patternKey ?? "-")}</p>
                  <p className="mt-1 text-zinc-400">
                    {String(row.decision ?? "-")} | {String(row.errorType ?? "-")} | Avg {fmt(row.avgReturn, 4)}%
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
