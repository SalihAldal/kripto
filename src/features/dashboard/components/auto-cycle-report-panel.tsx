"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/src/components/common/panel";

export type AutoCycleReportItem = {
  id: string;
  cycleNo: number;
  status: "running" | "opened" | "skipped" | "closed" | "failed";
  symbol?: string | null;
  decision?: string | null;
  aiConfidence?: number | null;
  scannerScore?: number | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
  netPnl?: number | null;
  roePercent?: number | null;
  feeTotal?: number | null;
  result?: string | null;
  reason?: string | null;
  analysis?: string | null;
  executionId?: string | null;
  maxDurationSec: number;
  startedAt: string;
  updatedAt: string;
  closedAt?: string | null;
};

type Props = {
  items: AutoCycleReportItem[];
  active: boolean;
  maxDurationLabel: string;
};

function fmt(value: number | null | undefined, digits = 4) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(digits);
}

function statusLabel(status: AutoCycleReportItem["status"]) {
  if (status === "running") return "Tariyor";
  if (status === "opened") return "Pozisyon acik";
  if (status === "skipped") return "Pas gecildi";
  if (status === "closed") return "Kapandi";
  return "Hata";
}

function statusClass(status: AutoCycleReportItem["status"]) {
  if (status === "opened" || status === "running") return "border-primary/30 bg-primary/10 text-primary";
  if (status === "closed") return "border-secondary/30 bg-secondary/10 text-secondary";
  if (status === "skipped") return "border-outline-variant/30 bg-surface-container-low text-on-surface-variant";
  return "border-tertiary/30 bg-tertiary/10 text-tertiary";
}

export function AutoCycleReportPanel({ items, active, maxDurationLabel }: Props) {
  const [selected, setSelected] = useState<AutoCycleReportItem | null>(null);
  const summary = useMemo(() => {
    const closed = items.filter((item) => item.status === "closed");
    const opened = items.filter((item) => item.status === "opened" || item.status === "closed");
    const skipped = items.filter((item) => item.status === "skipped" || item.status === "failed");
    const netPnl = closed.reduce((acc, item) => acc + Number(item.netPnl ?? 0), 0);
    const feeTotal = closed.reduce((acc, item) => acc + Number(item.feeTotal ?? 0), 0);
    const avgRoe = closed.reduce((acc, item) => acc + Number(item.roePercent ?? 0), 0) / Math.max(1, closed.length);
    return { closed: closed.length, opened: opened.length, skipped: skipped.length, netPnl, feeTotal, avgRoe };
  }, [items]);

  return (
    <Panel title="Oto Cycle Raporu">
      {selected ? (
        <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/55 px-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl border border-outline-variant/30 bg-surface p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black tracking-tight">Cycle #{selected.cycleNo} Analiz Penceresi</h3>
                <p className="mt-1 text-xs text-on-surface-variant">
                  {selected.symbol ?? "-"} | {statusLabel(selected.status)} | Max elde tutma: {maxDurationLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg bg-surface-container-high px-3 py-1.5 text-xs font-bold"
              >
                Kapat
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-surface-container-low px-3 py-2">AI: {selected.decision ?? "-"} / {fmt(selected.aiConfidence, 2)}</div>
              <div className="rounded bg-surface-container-low px-3 py-2">Scanner: {fmt(selected.scannerScore, 2)}</div>
              <div className="rounded bg-surface-container-low px-3 py-2">Alis: {fmt(selected.entryPrice, 6)}</div>
              <div className="rounded bg-surface-container-low px-3 py-2">Satis: {fmt(selected.exitPrice, 6)}</div>
              <div className="rounded bg-surface-container-low px-3 py-2">Net PnL: {fmt(selected.netPnl, 6)}</div>
              <div className="rounded bg-surface-container-low px-3 py-2">ROE %: {fmt(selected.roePercent, 4)}</div>
              <div className="rounded bg-surface-container-low px-3 py-2">Fee: {fmt(selected.feeTotal, 8)}</div>
              <div className="rounded bg-surface-container-low px-3 py-2">Sonuc: {selected.result ?? "-"}</div>
            </div>
            {selected.reason ? (
              <p className="mt-3 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
                {selected.reason}
              </p>
            ) : null}
            <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-outline-variant/30 bg-surface-container-low p-3 text-[11px] text-on-surface-variant">
              {selected.analysis || "Bu cycle icin detayli analiz henuz olusmadi."}
            </pre>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-lg bg-surface-container-low px-3 py-2">
          <p className="text-on-surface-variant">Durum</p>
          <p className={active ? "font-black text-secondary" : "font-black text-on-surface-variant"}>{active ? "Aktif" : "Pasif"}</p>
        </div>
        <div className="rounded-lg bg-surface-container-low px-3 py-2">
          <p className="text-on-surface-variant">Acilan / Pas</p>
          <p className="font-black">{summary.opened} / {summary.skipped}</p>
        </div>
        <div className="rounded-lg bg-surface-container-low px-3 py-2">
          <p className="text-on-surface-variant">Ort. ROE</p>
          <p className={summary.avgRoe >= 0 ? "font-black text-secondary" : "font-black text-tertiary"}>{fmt(summary.avgRoe, 4)}%</p>
        </div>
        <div className="rounded-lg bg-surface-container-low px-3 py-2">
          <p className="text-on-surface-variant">Fee / Net</p>
          <p className="font-black">{fmt(summary.feeTotal, 6)} / {fmt(summary.netPnl, 6)}</p>
        </div>
      </div>

      <div className="mt-3 max-h-80 space-y-2 overflow-auto text-xs">
        {items.length === 0 ? (
          <p className="rounded-lg bg-surface-container-low px-3 py-3 text-on-surface-variant">
            Oto cycle baslayinca her deneme burada canli raporlanacak.
          </p>
        ) : null}
        {items.map((item) => (
          <article key={item.id} className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-black">Cycle #{item.cycleNo} - {item.symbol ?? "coin secilmedi"}</p>
                <p className="mt-0.5 text-on-surface-variant">
                  {new Date(item.startedAt).toLocaleTimeString("tr-TR")} | Max {maxDurationLabel}
                </p>
              </div>
              <span className={`rounded-md border px-2 py-1 text-[11px] font-bold ${statusClass(item.status)}`}>
                {statusLabel(item.status)}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <span>Alis: {fmt(item.entryPrice, 6)}</span>
              <span>Satis: {fmt(item.exitPrice, 6)}</span>
              <span className={Number(item.roePercent ?? 0) >= 0 ? "text-secondary" : "text-tertiary"}>
                ROE: {item.roePercent == null ? "-" : `${fmt(item.roePercent, 4)}%`}
              </span>
              <span>Fee: {fmt(item.feeTotal, 8)}</span>
            </div>
            {item.reason ? <p className="mt-2 line-clamp-2 text-on-surface-variant">{item.reason}</p> : null}
            <button
              type="button"
              onClick={() => setSelected(item)}
              className="mt-2 rounded-md bg-surface-container-high px-2 py-1 text-[11px] font-bold hover:bg-surface-container"
            >
              Analiz Penceresi
            </button>
          </article>
        ))}
      </div>
    </Panel>
  );
}
