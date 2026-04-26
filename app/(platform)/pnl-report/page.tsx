"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/client-api";
import { PnlReportDashboard } from "@/src/features/trading/components/pnl-report-dashboard";
import type { PnlReportResponse } from "@/src/types/platform";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function toQuery(filters: {
  period: string;
  startDate: string;
  endDate: string;
  coin: string;
  aiModel: string;
  mode: string;
}) {
  const params = new URLSearchParams();
  params.set("period", filters.period);
  if (filters.period === "custom") {
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);
  }
  if (filters.coin && filters.coin !== "all") params.set("coin", filters.coin);
  if (filters.aiModel && filters.aiModel !== "all") params.set("aiModel", filters.aiModel);
  if (filters.mode && filters.mode !== "all") params.set("mode", filters.mode);
  return params.toString();
}

export default function PnlReportPage() {
  const [data, setData] = useState<PnlReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    period: "monthly" as "daily" | "weekly" | "monthly" | "custom",
    startDate: todayIso(),
    endDate: todayIso(),
    coin: "all",
    aiModel: "all",
    mode: "all" as "all" | "manual" | "auto",
  });

  const query = useMemo(() => toQuery(filters), [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await apiGet<PnlReportResponse>(`/api/reports/pnl?${query}`);
      setData(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const onFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const onExport = (format: "csv" | "excel") => {
    const exportQuery = `${query}&format=${format}`;
    window.open(`/api/reports/pnl/export?${exportQuery}`, "_blank");
  };

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-black tracking-tight">Kar / Zarar Raporu</h1>
      <p className="text-sm text-on-surface-variant">
        Ozet metrikler, coin/AI performansi, drawdown analizi ve detayli alis-satis gecmisi.
      </p>
      <PnlReportDashboard
        data={data}
        loading={loading}
        error={error}
        filters={filters}
        onFilterChange={onFilterChange}
        onRefresh={load}
        onExport={onExport}
      />
    </div>
  );
}
