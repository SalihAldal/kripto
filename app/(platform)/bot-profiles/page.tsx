"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/client-api";
import type { BotProfileListSnapshot, TradingBotProfile } from "@/src/server/trading-core/bot-profiles";

function formatPnl(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function riskClass(level: string) {
  if (level === "HIGH") return "bg-tertiary/15 text-tertiary";
  if (level === "MEDIUM") return "bg-primary/15 text-primary";
  return "bg-secondary/15 text-secondary";
}

function BotCard({ bot }: { bot: TradingBotProfile }) {
  return (
    <Link href={`/bot-profiles/${bot.botId}`} className="group rounded-2xl bg-surface-container-low p-5 transition hover:-translate-y-1 hover:bg-surface-container">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-primary">{bot.strategyType}</p>
          <h2 className="mt-2 text-xl font-black">{bot.name}</h2>
          <p className="mt-2 line-clamp-2 text-sm text-on-surface-variant">{bot.description}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black ${riskClass(bot.riskLevel)}`}>{bot.riskLevel}</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {bot.tags.slice(0, 4).map((tag) => (
          <span key={tag} className="rounded-full bg-surface-container-high px-2 py-1 text-xs font-bold text-on-surface-variant">
            #{tag}
          </span>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-xl bg-surface-container p-3">
          <p className="text-on-surface-variant">Winrate</p>
          <p className="mt-1 text-lg font-black">%{bot.metrics.winrate.toFixed(1)}</p>
        </div>
        <div className="rounded-xl bg-surface-container p-3">
          <p className="text-on-surface-variant">Aylik PnL</p>
          <p className={`mt-1 text-lg font-black ${bot.monthlyPnl >= 0 ? "text-secondary" : "text-tertiary"}`}>{formatPnl(bot.monthlyPnl)}</p>
        </div>
        <div className="rounded-xl bg-surface-container p-3">
          <p className="text-on-surface-variant">AI Conf.</p>
          <p className="mt-1 text-lg font-black">%{bot.aiConfidence.toFixed(0)}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-on-surface-variant">
        <span>Lev {bot.recommendedLeverage}x · {bot.tradeFrequency}</span>
        <span className="font-black text-on-surface">★ {bot.ratingAverage.toFixed(1)} ({bot.ratingCount})</span>
      </div>
    </Link>
  );
}

export default function BotProfilesPage() {
  const [snapshot, setSnapshot] = useState<BotProfileListSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("ALL");

  useEffect(() => {
    const load = async () => {
      try {
        setSnapshot(await apiGet<BotProfileListSnapshot>("/api/trading-core/bot-profiles"));
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      }
    };
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  const profiles = useMemo(() => {
    const rows = snapshot?.profiles ?? [];
    return filter === "ALL" ? rows : rows.filter((bot) => bot.strategyType === filter);
  }, [filter, snapshot]);

  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-gradient-to-br from-primary/20 via-surface-container-low to-secondary/10 p-6">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-primary">Bot Marketplace</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Profesyonel Bot Profilleri</h1>
        <p className="mt-2 max-w-3xl text-sm text-on-surface-variant">
          Risk seviyesi, winrate, aylik PnL, drawdown, AI confidence ve kullanici ratingleriyle marketplace benzeri bot listesi.
        </p>
      </div>

      {error ? <div className="rounded-xl bg-tertiary/15 p-3 text-sm text-tertiary">{error}</div> : null}

      <div className="flex flex-wrap gap-2">
        {["ALL", "SCALPING", "TREND", "BREAKOUT", "AI_ASSISTED"].map((item) => (
          <button
            key={item}
            onClick={() => setFilter(item)}
            className={`rounded-full px-4 py-2 text-xs font-black ${filter === item ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface-variant"}`}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {profiles.map((bot) => (
          <BotCard key={bot.botId} bot={bot} />
        ))}
      </div>
    </div>
  );
}
