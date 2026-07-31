"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/client-api";
import type { BotProfileRating, TradingBotProfile } from "@/src/server/trading-core/bot-profiles";

type DetailResponse = {
  profile: TradingBotProfile;
  ratings: BotProfileRating[];
};

function formatPnl(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

export default function BotProfileDetailPage() {
  const params = useParams<{ botId: string }>();
  const botId = params?.botId;
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!botId) return;
    try {
      setData(await apiGet<DetailResponse>(`/api/trading-core/bot-profiles/${botId}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [botId]);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const pnlMax = useMemo(() => {
    const values = data?.profile.performanceCurve.map((row) => Math.abs(row.pnl)) ?? [];
    return Math.max(1, ...values);
  }, [data]);

  const submitRating = async () => {
    setSaving(true);
    try {
      if (!botId) return;
      await apiPost(`/api/trading-core/bot-profiles/${botId}/rating`, { stars, comment: comment || undefined });
      setComment("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const bot = data?.profile;

  return (
    <div className="space-y-5">
      <Link href="/bot-profiles" className="text-sm font-bold text-primary">← Bot listesine don</Link>
      {error ? <div className="rounded-xl bg-tertiary/15 p-3 text-sm text-tertiary">{error}</div> : null}
      {!bot ? <div className="rounded-xl bg-surface-container-low p-5">Bot profili yukleniyor...</div> : null}
      {bot ? (
        <>
          <section className="rounded-3xl bg-surface-container-low p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-primary">{bot.strategyType}</p>
                <h1 className="mt-2 text-3xl font-black">{bot.name}</h1>
                <p className="mt-2 max-w-3xl text-sm text-on-surface-variant">{bot.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {bot.supportedPairs.map((pair) => (
                    <span key={pair} className="rounded-full bg-surface-container px-3 py-1 text-xs font-bold">{pair}</span>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl bg-surface-container p-4 text-sm">
                <p className="text-on-surface-variant">Kullanici Rating</p>
                <p className="text-3xl font-black">★ {bot.ratingAverage.toFixed(1)}</p>
                <p className="text-xs text-on-surface-variant">{bot.ratingCount} yorum</p>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            {[
              ["Risk", bot.riskLevel],
              ["Winrate", `%${bot.metrics.winrate.toFixed(1)}`],
              ["Aylik PnL", formatPnl(bot.monthlyPnl)],
              ["Max DD", bot.maxDrawdown.toFixed(2)],
              ["Leverage", `${bot.recommendedLeverage}x`],
              ["AI Conf.", `%${bot.aiConfidence.toFixed(0)}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-surface-container-low p-4">
                <p className="text-xs text-on-surface-variant">{label}</p>
                <p className="mt-1 text-xl font-black">{value}</p>
              </div>
            ))}
          </div>

          <section className="rounded-xl bg-surface-container-low p-4">
            <h2 className="text-lg font-black">Performans Grafigi</h2>
            <div className="mt-4 flex h-56 items-end gap-1 rounded-xl bg-surface-container p-3">
              {[...bot.performanceCurve].reverse().map((row) => (
                <div
                  key={row.timestamp}
                  title={`${new Date(row.timestamp).toLocaleDateString()} PnL ${row.pnl}`}
                  className={`flex-1 rounded-t ${row.pnl >= 0 ? "bg-secondary" : "bg-tertiary"}`}
                  style={{ height: `${Math.max(8, Math.abs(row.pnl) / pnlMax * 100)}%` }}
                />
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <section className="rounded-xl bg-surface-container-low p-4">
              <h2 className="text-lg font-black">Performans Metrikleri</h2>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <p>Trade Count: <b>{bot.metrics.tradeCount}</b></p>
                <p>Profit Factor: <b>{bot.metrics.profitFactor.toFixed(2)}</b></p>
                <p>Sharpe: <b>{bot.metrics.sharpeRatio.toFixed(2)}</b></p>
                <p>Score: <b>{bot.metrics.botScore.toFixed(1)}</b></p>
                <p>Frequency: <b>{bot.tradeFrequency}</b></p>
                <p>Consistency: <b>%{bot.metrics.strategyConsistency.toFixed(1)}</b></p>
              </div>
            </section>

            <section className="rounded-xl bg-surface-container-low p-4">
              <h2 className="text-lg font-black">Rating Ver</h2>
              <div className="mt-3 flex gap-2">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button key={value} onClick={() => setStars(value)} className={`rounded-lg px-3 py-2 font-black ${stars >= value ? "bg-primary text-on-primary" : "bg-surface-container"}`}>
                    ★
                  </button>
                ))}
              </div>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className="mt-3 min-h-24 w-full rounded-xl bg-surface-container p-3 text-sm outline-none"
                placeholder="Bot hakkinda yorum..."
              />
              <button onClick={submitRating} disabled={saving} className="mt-3 rounded-xl bg-primary px-4 py-2 text-sm font-black text-on-primary disabled:opacity-50">
                {saving ? "Kaydediliyor..." : "Rating Gonder"}
              </button>
            </section>
          </div>

          <section className="rounded-xl bg-surface-container-low p-4">
            <h2 className="text-lg font-black">Kullanici Yorumlari</h2>
            <div className="mt-3 space-y-2">
              {(data?.ratings ?? []).map((rating) => (
                <div key={rating.ratingId} className="rounded-lg bg-surface-container p-3 text-sm">
                  <p className="font-black">★ {rating.stars} · {new Date(rating.createdAt).toLocaleString()}</p>
                  <p className="mt-1 text-on-surface-variant">{rating.comment || "Yorum yok."}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
