"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/src/components/common/panel";
import type { TradeLifecycleEvent } from "@/src/types/platform";

type Props = {
  events: TradeLifecycleEvent[];
  loading?: boolean;
  onRefresh?: () => void;
};

const statusStyles: Record<TradeLifecycleEvent["status"], string> = {
  SUCCESS: "border-secondary/30 bg-secondary/10 text-secondary",
  RUNNING: "border-primary/30 bg-primary/10 text-primary",
  PENDING: "border-primary/30 bg-primary/10 text-primary",
  SKIPPED: "border-primary/30 bg-primary/10 text-primary",
  FAILED: "border-tertiary/40 bg-tertiary/10 text-tertiary",
};

function toSafeNumber(value: unknown) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function toContextText(event: TradeLifecycleEvent) {
  const context = event.context ?? {};
  const reason =
    context.sellOrderRejectedReason ??
    context.closeNotExecutedReason ??
    context.reason ??
    context.closeError;
  if (typeof reason === "string" && reason.length > 0) return reason;
  return event.message;
}

function toSellStatusLabel(event: TradeLifecycleEvent) {
  const raw = String((event.context?.orderStatus ?? event.context?.exchangeStatus ?? event.status) ?? event.status).toUpperCase();
  if (raw.includes("FILLED")) return "Gerceklesti";
  if (raw.includes("CANCEL")) return "Iptal";
  if (raw.includes("REJECT") || raw.includes("FAIL")) return "Reddedildi";
  if (raw.includes("PARTIALLY")) return "Kismi Dolum";
  return "Beklemede";
}

function toTimeline(events: TradeLifecycleEvent[], seed: TradeLifecycleEvent) {
  const byExecution = seed.executionId
    ? events.filter((row) => row.executionId === seed.executionId)
    : events.filter((row) => row.symbol === seed.symbol).slice(0, 12);
  return [...byExecution]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-14);
}

export function TradeFlowPanel({ events, loading = false, onRefresh }: Props) {
  const [selected, setSelected] = useState<TradeLifecycleEvent | null>(null);
  const latest = events[0];

  const cards = useMemo(() => {
    const running = events.filter((x) => x.status === "RUNNING" || x.status === "PENDING").length;
    const success = events.filter((x) => x.status === "SUCCESS").length;
    const failed = events.filter((x) => x.status === "FAILED").length;
    return [
      { label: "Bekleyen", value: running, tone: "text-primary" },
      { label: "Basarili", value: success, tone: "text-secondary" },
      { label: "Hatali", value: failed, tone: "text-tertiary" },
    ];
  }, [events]);

  const timeline = useMemo(() => (selected ? toTimeline(events, selected) : []), [events, selected]);

  return (
    <Panel
      title="Islem Durumu / Emir Akisi"
      right={
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-md bg-surface-container-high px-2 py-1 text-[11px] font-bold text-on-surface hover:bg-surface-container"
        >
          Yenile
        </button>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {cards.map((card) => (
          <article key={card.label} className="rounded-lg border border-outline-variant/25 bg-surface-container-low px-3 py-2">
            <p className="text-[11px] text-on-surface-variant">{card.label}</p>
            <p className={`text-lg font-black ${card.tone}`}>{card.value}</p>
          </article>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-outline-variant/20">
        <div className="grid grid-cols-12 gap-2 border-b border-outline-variant/20 bg-surface-container-low px-3 py-2 text-[11px] font-bold text-on-surface-variant">
          <span className="col-span-2">Saat</span>
          <span className="col-span-2">Sembol</span>
          <span className="col-span-2">Asama</span>
          <span className="col-span-2">Durum</span>
          <span className="col-span-4">Not</span>
        </div>
        <div className="max-h-72 overflow-auto">
          {events.length === 0 ? (
            <p className="px-3 py-4 text-xs text-on-surface-variant">{loading ? "Yukleniyor..." : "Event kaydi bulunamadi."}</p>
          ) : (
            events.slice(0, 60).map((row) => (
              <button
                key={`${row.id ?? row.createdAt}-${row.stage}`}
                type="button"
                onClick={() => setSelected(row)}
                className="grid w-full grid-cols-12 gap-2 border-b border-outline-variant/10 px-3 py-2 text-left text-xs hover:bg-surface-container-low/70"
              >
                <span className="col-span-2 text-on-surface-variant">
                  {new Date(row.createdAt).toLocaleTimeString("tr-TR")}
                </span>
                <span className="col-span-2 font-semibold">{row.symbol ?? "-"}</span>
                <span className="col-span-2 text-on-surface-variant">{row.stage}</span>
                <span className="col-span-2">
                  <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${statusStyles[row.status]}`}>
                    {toSellStatusLabel(row)}
                  </span>
                </span>
                <span className="col-span-4 truncate text-on-surface-variant">{toContextText(row)}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {latest ? (
        <div className="mt-3 rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-2 text-xs">
          <p className="font-bold">Anlik Ozet</p>
          <p className="mt-1 text-on-surface-variant">
            {latest.symbol ?? "-"} | {latest.stage} | {latest.message}
          </p>
        </div>
      ) : null}

      {selected ? (
        <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-3xl rounded-xl border border-outline-variant/30 bg-surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-black">Order / Islem Detayi</h3>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-md bg-surface-container-high px-3 py-1 text-xs font-bold"
              >
                Kapat
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border border-outline-variant/20 bg-surface-container-low px-3 py-2">
                <p className="text-on-surface-variant">Sembol</p>
                <p className="font-semibold">{selected.symbol ?? "-"}</p>
              </div>
              <div className="rounded-md border border-outline-variant/20 bg-surface-container-low px-3 py-2">
                <p className="text-on-surface-variant">Durum</p>
                <p className="font-semibold">{toSellStatusLabel(selected)}</p>
              </div>
              <div className="rounded-md border border-outline-variant/20 bg-surface-container-low px-3 py-2">
                <p className="text-on-surface-variant">Order ID</p>
                <p className="font-mono text-[11px]">{String(selected.orderId ?? selected.context?.orderId ?? selected.context?.exchangeOrderId ?? "-")}</p>
              </div>
              <div className="rounded-md border border-outline-variant/20 bg-surface-container-low px-3 py-2">
                <p className="text-on-surface-variant">Quantity</p>
                <p className="font-semibold">
                  {toSafeNumber(selected.context?.quantity ?? selected.context?.requestedSellQty ?? selected.context?.filledQty).toFixed(8)}
                </p>
              </div>
              <div className="rounded-md border border-outline-variant/20 bg-surface-container-low px-3 py-2">
                <p className="text-on-surface-variant">Fiyat</p>
                <p className="font-semibold">{toSafeNumber(selected.context?.targetSellPrice ?? selected.context?.executionPrice ?? selected.context?.exitPrice).toFixed(6)} TL</p>
              </div>
              <div className="rounded-md border border-outline-variant/20 bg-surface-container-low px-3 py-2">
                <p className="text-on-surface-variant">Sebep</p>
                <p className="font-semibold">{toContextText(selected)}</p>
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-2">
              <p className="text-xs font-bold">Event Timeline</p>
              <div className="mt-2 max-h-44 space-y-1 overflow-auto text-xs">
                {timeline.map((row) => (
                  <div key={`${row.id ?? row.createdAt}-${row.stage}-${row.message}`} className="rounded border border-outline-variant/20 px-2 py-1">
                    <span className="text-on-surface-variant">{new Date(row.createdAt).toLocaleTimeString("tr-TR")}</span>{" "}
                    <span className="font-semibold">{row.stage}</span> - {row.message}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
