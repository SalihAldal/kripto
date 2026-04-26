"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/client-api";
import { Panel } from "@/src/components/common/panel";
import { PlaceholderChart } from "@/src/components/common/placeholder-chart";
import { OrderBookPanel } from "@/src/features/dashboard/components/order-book-panel";
import { MarketScannerTable } from "@/src/features/dashboard/components/market-scanner-table";
import { useI18n } from "@/src/i18n/provider";
import { useAsyncState } from "@/src/lib/use-async-state";
import type { OrderBookRow, ScannerRow } from "@/src/types/platform";

type OrderBookApi = {
  bids: Array<{ price: number; quantity: number }>;
  asks: Array<{ price: number; quantity: number }>;
};

function sameRows(prev: ScannerRow[], next: ScannerRow[]) {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (a.symbol !== b.symbol || a.price !== b.price || a.change24h !== b.change24h || a.aiScore !== b.aiScore) return false;
  }
  return true;
}

function sameOrderBook(prev: OrderBookRow[], next: OrderBookRow[]) {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (a.side !== b.side || a.price !== b.price || a.amount !== b.amount || a.total !== b.total) return false;
  }
  return true;
}

export default function MarketWatchPage() {
  const { t } = useI18n();
  const [connected, setConnected] = useState(false);
  const [activeSymbol, setActiveSymbol] = useState("BTCTRY");
  const [liveRows, setLiveRows] = useState<ScannerRow[]>([]);
  const [orderBook, setOrderBook] = useState<OrderBookRow[]>([]);
  const [isVisible, setIsVisible] = useState(true);

  const state = useAsyncState(async () => {
    const remote = await apiGet<ScannerRow[]>("/api/market/scan").catch(() => null);
    return remote ?? [];
  }, [] as ScannerRow[]);

  useEffect(() => {
    const onVisibilityChange = () => {
      setIsVisible(document.visibilityState === "visible");
    };
    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    const loadOrderBook = async () => {
      const data = await apiGet<OrderBookApi>(`/api/exchange/orderbook?symbol=${activeSymbol}&limit=8`).catch(() => null);
      if (!data) return;
      const asks = data.asks.slice(0, 4).map((x) => ({
        side: "ask" as const,
        price: x.price,
        amount: x.quantity,
        total: x.price * x.quantity,
      }));
      const bids = data.bids.slice(0, 4).map((x) => ({
        side: "bid" as const,
        price: x.price,
        amount: x.quantity,
        total: x.price * x.quantity,
      }));
      const next = [...asks, ...bids];
      setOrderBook((prev) => (sameOrderBook(prev, next) ? prev : next));
    };
    void loadOrderBook();
    const timer = setInterval(loadOrderBook, isVisible ? 3000 : 15000);
    return () => clearInterval(timer);
  }, [activeSymbol, isVisible]);

  useEffect(() => {
    if (!isVisible) return;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      source = new EventSource("/api/stream?mode=market&withAi=1&intervalMs=6000");
      source.onopen = () => setConnected(true);
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as ScannerRow[];
          if (Array.isArray(payload) && payload.length > 0) {
            setLiveRows((prev) => (sameRows(prev, payload) ? prev : payload));
            setActiveSymbol((prev) => (prev === payload[0].symbol ? prev : payload[0].symbol));
          }
        } catch {
          // noop
        }
      };
      source.onerror = () => {
        setConnected(false);
        source?.close();
        timer = setTimeout(connect, 1600);
      };
    };
    connect();
    return () => {
      source?.close();
      if (timer) clearTimeout(timer);
    };
  }, [isVisible]);

  const rows = liveRows.length > 0 ? liveRows : state.data;

  return (
    <div className="space-y-5">
      <header className="flex justify-between items-center">
        <h1 className="text-3xl font-black tracking-tight">{t("marketWatch.title")}</h1>
        <span className={`text-xs font-bold ${connected ? "text-secondary" : "text-tertiary"}`}>
          {isVisible && connected ? t("marketWatch.connected") : t("marketWatch.reconnecting")}
        </span>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 space-y-4">
          <Panel title={t("marketWatch.liveChart")}>
            <PlaceholderChart height={300} />
          </Panel>
          <MarketScannerTable rows={rows} loading={state.loading} error={state.error} onRetry={state.reload} />
        </div>
        <div className="xl:col-span-4">
          <OrderBookPanel rows={orderBook} />
        </div>
      </div>
    </div>
  );
}
