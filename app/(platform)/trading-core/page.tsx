"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/client-api";
import { Panel } from "@/src/components/common/panel";

type DashboardPayload = {
  regime: {
    regime: string;
    confidence: number;
    regimeStrength: number;
    expectedDurationMinutes?: number;
    supportingFeatures?: Record<string, unknown>;
    classifiedAt?: string;
  } | null;
  discovery: {
    scannedAt: string;
    totalSymbols: number;
    rankedSymbols: number;
    marketRegime: string | null;
    report: {
      topGainers: string[];
      topBreakoutCandidates: string[];
      topMomentum: string[];
      topVolumeExpansion: string[];
      topRelativeStrength: string[];
    } | null;
    candidates: Array<{ symbol: string; rank: number; discoveryScore: number; reportCategory: string | null }>;
    rankings: Array<{ symbol: string; rank: number; discoveryScore: number; category: string | null }>;
  } | null;
  momentum: Array<{
    symbol: string;
    verdict: string;
    entryProbability: number;
    expectedRr: number;
    confidence: number;
    evaluatedAt: string;
  }>;
  stats: {
    hitRate: number;
    profitFactor: number;
    expectancy: number;
    sharpe: number;
    maxDrawdown: number;
    sampleSize: number;
  } | null;
  regimeHistory: Array<{ regime: string; confidence: number; classifiedAt: string }>;
  rejectedCandidates?: Array<{ symbol: string; rejectReason: string | null; discoveryScore: number }>;
  topOpportunities?: Array<{ symbol: string; rank: number; discoveryScore: number; reportCategory: string | null }>;
};

export default function TradingCoreDashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await apiGet<DashboardPayload>("/api/trading-core/s2/dashboard");
      setData(payload);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">Trading Core — Regime &amp; Discovery</h1>
      {error ? <p className="text-red-400 text-sm">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Market Regime">
          {data?.regime ? (
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Regime:</span> {data.regime.regime}
              </p>
              <p>
                <span className="text-muted-foreground">Confidence:</span> {data.regime.confidence}%
              </p>
              <p>
                <span className="text-muted-foreground">Strength:</span> {data.regime.regimeStrength}
              </p>
              <p>
                <span className="text-muted-foreground">Expected duration:</span>{" "}
                {data.regime.expectedDurationMinutes ?? "—"} min
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No regime data yet.</p>
          )}
        </Panel>

        <Panel title="Momentum Statistics">
          {data?.stats ? (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p>Hit rate: {data.stats.hitRate.toFixed(2)}%</p>
              <p>Profit factor: {data.stats.profitFactor.toFixed(2)}</p>
              <p>Expectancy: {data.stats.expectancy.toFixed(4)}</p>
              <p>Sharpe: {data.stats.sharpe.toFixed(2)}</p>
              <p>Max DD: {data.stats.maxDrawdown.toFixed(2)}</p>
              <p>Sample: {data.stats.sampleSize}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Statistics pending.</p>
          )}
        </Panel>
      </div>

      <Panel title="Discovery Ranking (Top 20)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="p-2">#</th>
                <th className="p-2">Symbol</th>
                <th className="p-2">Score</th>
                <th className="p-2">Category</th>
              </tr>
            </thead>
            <tbody>
              {(data?.discovery?.rankings ?? []).map((row) => (
                <tr key={`${row.symbol}-${row.rank}`} className="border-t border-border/40">
                  <td className="p-2">{row.rank}</td>
                  <td className="p-2 font-medium">{row.symbol}</td>
                  <td className="p-2">{row.discoveryScore.toFixed(1)}</td>
                  <td className="p-2">{row.category ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Momentum Candidates">
          <ul className="space-y-1 text-sm max-h-64 overflow-y-auto">
            {(data?.momentum ?? []).map((row) => (
              <li key={`${row.symbol}-${row.evaluatedAt}`} className="flex justify-between gap-2">
                <span>{row.symbol}</span>
                <span className="text-muted-foreground">
                  {row.verdict} · RR {row.expectedRr.toFixed(2)} · {row.confidence.toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Regime History">
          <ul className="space-y-1 text-sm max-h-64 overflow-y-auto">
            {(data?.regimeHistory ?? []).slice(0, 20).map((row) => (
              <li key={row.classifiedAt} className="flex justify-between gap-2">
                <span>{row.regime}</span>
                <span className="text-muted-foreground">{new Date(row.classifiedAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Rejected Candidates">
          <ul className="space-y-1 text-sm max-h-64 overflow-y-auto">
            {(data?.rejectedCandidates ?? []).map((row) => (
              <li key={`${row.symbol}-${row.rejectReason}`} className="flex justify-between gap-2">
                <span>{row.symbol}</span>
                <span className="text-muted-foreground text-xs">{row.rejectReason ?? "rejected"}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {data?.discovery?.report ? (
        <Panel title="Discovery Report">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 text-sm">
            {Object.entries(data.discovery.report).map(([key, symbols]) => (
              <div key={key}>
                <p className="font-medium capitalize mb-1">{key.replace(/([A-Z])/g, " $1")}</p>
                <p className="text-muted-foreground">{symbols.slice(0, 8).join(", ") || "—"}</p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
