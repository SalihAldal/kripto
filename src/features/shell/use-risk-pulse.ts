"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/client-api";

export type RiskStrictness = "normal" | "strict" | "very_strict";

export type RiskTimelineRow = {
  at: string;
  strictness: RiskStrictness;
  minConfidence: number;
  reason?: string;
};

export type RiskPulse = {
  strictness: RiskStrictness;
  minConfidence: number;
  reason: string;
  reasonData: {
    winRatePercent: number;
    maxDrawdown: number;
    deltaConfidence: number;
  };
};

type RiskPulseCache = {
  risk: RiskPulse | null;
  timeline: RiskTimelineRow[];
  activeTrendIdx: number | null;
  lastUpdatedAt: string | null;
};

let cache: RiskPulseCache | null = null;
const PASSIVE_MODE = process.env.NEXT_PUBLIC_DASHBOARD_PASSIVE_MODE !== "false";

export function isSameRiskPulse(prev: RiskPulse | null, next: RiskPulse) {
  if (!prev) return false;
  return (
    prev.strictness === next.strictness &&
    prev.minConfidence === next.minConfidence &&
    prev.reason === next.reason &&
    prev.reasonData.winRatePercent === next.reasonData.winRatePercent &&
    prev.reasonData.maxDrawdown === next.reasonData.maxDrawdown &&
    prev.reasonData.deltaConfidence === next.reasonData.deltaConfidence
  );
}

export function isSameTimeline(prev: RiskTimelineRow[], next: RiskTimelineRow[]) {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (
      prev[i]?.at !== next[i]?.at ||
      prev[i]?.strictness !== next[i]?.strictness ||
      prev[i]?.minConfidence !== next[i]?.minConfidence ||
      prev[i]?.reason !== next[i]?.reason
    ) {
      return false;
    }
  }
  return true;
}

export function normalizeTimeline(rows: RiskTimelineRow[], max = 5) {
  return rows.slice(-max);
}

export function getNextActiveTrendIndex(prev: number | null, length: number) {
  if (length === 0) return null;
  if (prev === null) return length - 1;
  return Math.min(prev, length - 1);
}

export function pickSelectedTrend(timeline: RiskTimelineRow[], activeTrendIdx: number | null) {
  if (activeTrendIdx !== null && timeline[activeTrendIdx]) return timeline[activeTrendIdx];
  return timeline[timeline.length - 1];
}

export function getEffectivePollMs(isVisible: boolean, visibleMs: number, hiddenMs = 30000) {
  return isVisible ? visibleMs : hiddenMs;
}

export function getRiskFreshness(lastUpdatedAt: string | null, staleMs = 45000) {
  if (!lastUpdatedAt) return "cold" as const;
  const age = Date.now() - new Date(lastUpdatedAt).getTime();
  return age > staleMs ? ("stale" as const) : ("fresh" as const);
}

export function useRiskPulse(pollMs = 10000, staleMs = 45000) {
  const [risk, setRisk] = useState<RiskPulse | null>(() => cache?.risk ?? null);
  const [timeline, setTimeline] = useState<RiskTimelineRow[]>(() => cache?.timeline ?? []);
  const [activeTrendIdx, setActiveTrendIdx] = useState<number | null>(() => cache?.activeTrendIdx ?? null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(() => cache?.lastUpdatedAt ?? null);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setIsVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    if (PASSIVE_MODE) return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failureCount = 0;

    const load = async () => {
      const data = await apiGet<{
        adaptive?: RiskPulse;
        timeline?: RiskTimelineRow[];
      }>("/api/metrics/performance").catch(() => null);

      const adaptive = data?.adaptive;
      if (!mounted || !adaptive) return false;

      setRisk((prev) => {
        if (isSameRiskPulse(prev, adaptive)) return prev;
        return adaptive;
      });

      const nextTimeline = normalizeTimeline(data.timeline ?? []);
      setTimeline((prev) => {
        if (isSameTimeline(prev, nextTimeline)) return prev;
        return nextTimeline;
      });
      let computedActiveIdx: number | null = null;
      setActiveTrendIdx((prev) => {
        computedActiveIdx = getNextActiveTrendIndex(prev, nextTimeline.length);
        return computedActiveIdx;
      });
      const nowIso = new Date().toISOString();
      setLastUpdatedAt(nowIso);
      cache = {
        risk: adaptive,
        timeline: nextTimeline,
        activeTrendIdx: computedActiveIdx,
        lastUpdatedAt: nowIso,
      };
      return true;
    };

    const scheduleNext = () => {
      const baseMs = getEffectivePollMs(isVisible, pollMs);
      const backoffMs = Math.min(60000, failureCount * 2000);
      timer = setTimeout(async () => {
        const ok = await load();
        failureCount = ok ? 0 : failureCount + 1;
        if (mounted) scheduleNext();
      }, baseMs + backoffMs);
    };

    void load().then((ok) => {
      failureCount = ok ? 0 : 1;
      if (mounted) scheduleNext();
    });

    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [isVisible, pollMs]);

  useEffect(() => {
    if (!cache) return;
    cache = { ...cache, activeTrendIdx };
  }, [activeTrendIdx]);

  const selectedTrend = useMemo(() => {
    return pickSelectedTrend(timeline, activeTrendIdx);
  }, [activeTrendIdx, timeline]);

  const freshness = useMemo(() => getRiskFreshness(lastUpdatedAt, staleMs), [lastUpdatedAt, staleMs]);

  return {
    risk,
    timeline,
    activeTrendIdx,
    setActiveTrendIdx,
    selectedTrend,
    lastUpdatedAt,
    freshness,
  };
}
