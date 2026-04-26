"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/client-api";
import { Panel } from "@/src/components/common/panel";
import type { AutoRoundStatusResponse } from "@/src/types/platform";

type Props = {
  onNotify: (message: string, tone: "success" | "error" | "info") => void;
  livePollingEnabled?: boolean;
};

export function AutoRoundControlPanel({ onNotify, livePollingEnabled = true }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<AutoRoundStatusResponse | null>(null);
  const [config, setConfig] = useState({
    totalRounds: 10,
    budgetPerTrade: 1000,
    targetProfitPct: 2.5,
    stopLossPct: 1.4,
    maxWaitSec: 600,
    coinSelectionMode: "scanner_best",
    aiMode: "consensus",
    allowRepeatCoin: false,
  });

  const refresh = async () => {
    const data = await apiGet<AutoRoundStatusResponse>("/api/trades/rounds/status").catch(() => null);
    if (data) setStatus(data);
  };

  useEffect(() => {
    void refresh();
    if (!livePollingEnabled) return;
    const timer = setInterval(() => {
      void refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [livePollingEnabled]);

  const active = status?.active ?? null;
  const remaining = Math.max(0, (active?.totalRounds ?? 0) - ((active?.completedRounds ?? 0) + (active?.failedRounds ?? 0)));
  const totalNetPnl = useMemo(() => {
    const source = active?.rounds ?? [];
    return source.reduce((acc, row) => acc + Number(row.netPnl ?? 0), 0);
  }, [active?.rounds]);

  const start = async () => {
    setLoading(true);
    try {
      const resp = await apiPost<{ started: boolean; reason?: string }>("/api/trades/rounds/start", {
        ...config,
        mode: "auto",
      });
      if (!resp.started) {
        onNotify(resp.reason ?? "Tur motoru baslatilamadi", "info");
      } else {
        onNotify("Tur motoru baslatildi", "success");
      }
      await refresh();
    } catch (error) {
      onNotify((error as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  const stop = async () => {
    setLoading(true);
    try {
      const resp = await apiPost<{ stopped: boolean; reason?: string }>("/api/trades/rounds/stop", {});
      if (!resp.stopped) {
        onNotify(resp.reason ?? "Aktif tur motoru yok", "info");
      } else {
        onNotify("Tur motoru durdurma istegi gonderildi", "success");
      }
      await refresh();
    } catch (error) {
      onNotify((error as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel title="Tur Bazli Oto Islem">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label>
          Tur Sayisi
          <select
            value={config.totalRounds}
            onChange={(e) => setConfig((prev) => ({ ...prev, totalRounds: Number(e.target.value) }))}
            className="mt-1 w-full rounded-lg bg-surface-container-low px-2 py-2"
          >
            {[1, 3, 5, 10, 20].map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label>
          Butce / Islem (TRY)
          <input
            type="number"
            value={config.budgetPerTrade}
            onChange={(e) => setConfig((prev) => ({ ...prev, budgetPerTrade: Number(e.target.value || 0) }))}
            className="mt-1 w-full rounded-lg bg-surface-container-low px-2 py-2"
          />
        </label>
        <label>
          Hedef Kar %
          <input
            type="number"
            step="0.1"
            value={config.targetProfitPct}
            onChange={(e) => setConfig((prev) => ({ ...prev, targetProfitPct: Number(e.target.value || 0) }))}
            className="mt-1 w-full rounded-lg bg-surface-container-low px-2 py-2"
          />
        </label>
        <label>
          Stop Loss %
          <input
            type="number"
            step="0.1"
            value={config.stopLossPct}
            onChange={(e) => setConfig((prev) => ({ ...prev, stopLossPct: Number(e.target.value || 0) }))}
            className="mt-1 w-full rounded-lg bg-surface-container-low px-2 py-2"
          />
        </label>
        <label>
          Maks Bekleme (sn)
          <input
            type="number"
            value={config.maxWaitSec}
            onChange={(e) => setConfig((prev) => ({ ...prev, maxWaitSec: Number(e.target.value || 0) }))}
            className="mt-1 w-full rounded-lg bg-surface-container-low px-2 py-2"
          />
        </label>
        <label>
          Coin Secim Modu
          <select
            value={config.coinSelectionMode}
            onChange={(e) => setConfig((prev) => ({ ...prev, coinSelectionMode: e.target.value }))}
            className="mt-1 w-full rounded-lg bg-surface-container-low px-2 py-2"
          >
            <option value="scanner_best">Scanner Best</option>
            <option value="scanner_try_first">TRY First</option>
          </select>
        </label>
        <label>
          AI Modu
          <select
            value={config.aiMode}
            onChange={(e) => setConfig((prev) => ({ ...prev, aiMode: e.target.value }))}
            className="mt-1 w-full rounded-lg bg-surface-container-low px-2 py-2"
          >
            <option value="consensus">Consensus</option>
            <option value="ultra">Ultra</option>
          </select>
        </label>
        <label className="flex items-end gap-2 pb-2">
          <input
            type="checkbox"
            checked={config.allowRepeatCoin}
            onChange={(e) => setConfig((prev) => ({ ...prev, allowRepeatCoin: e.target.checked }))}
          />
          Ayni coin tekrar alinabilsin
        </label>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={start}
          disabled={loading || Boolean(active)}
          className="rounded-lg bg-secondary px-3 py-2 text-xs font-bold text-black disabled:opacity-50"
        >
          Tur Motorunu Baslat
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={loading || !active}
          className="rounded-lg bg-tertiary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          Motoru Durdur
        </button>
      </div>

      <div className="mt-3 rounded-lg border border-outline-variant/20 bg-surface-container-low p-3 text-xs">
        <p>Toplam Hedef Tur: {active?.totalRounds ?? 0}</p>
        <p>Tamamlanan Tur: {active?.completedRounds ?? 0}</p>
        <p>Kalan Tur: {remaining}</p>
        <p>Aktif Durum: {active?.activeState ?? "bekliyor"}</p>
        <p className={totalNetPnl >= 0 ? "text-secondary" : "text-tertiary"}>Toplam Oto PnL: {totalNetPnl.toFixed(6)}</p>
      </div>

      <div className="mt-3 max-h-52 space-y-1 overflow-auto text-xs">
        {(active?.rounds ?? []).map((row) => (
          <article key={row.id} className="rounded-md border border-outline-variant/20 bg-surface-container-low px-2 py-1">
            <p className="font-semibold">
              Tur #{row.roundNo} - {row.state}
            </p>
            <p>
              Coin: {row.symbol ?? "-"} | Alis: {Number(row.buyPrice ?? 0).toFixed(6)} | Satis: {Number(row.sellPrice ?? 0).toFixed(6)}
            </p>
            <p className={Number(row.netPnl ?? 0) >= 0 ? "text-secondary" : "text-tertiary"}>
              PnL: {Number(row.netPnl ?? 0).toFixed(6)} | Sonuc: {row.result ?? "-"}
            </p>
            {row.failReason ? <p className="text-tertiary">Sebep: {row.failReason}</p> : null}
          </article>
        ))}
      </div>
    </Panel>
  );
}
