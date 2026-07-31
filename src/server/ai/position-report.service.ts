import type { KlineItem, OrderBookSnapshot } from "@/src/types/exchange";

export type PositionSignal = "TUT" | "DİKKAT" | "SAT";

export type PositionReportInput = {
  symbol: string;
  entryPrice: number;
  currentPrice: number;
  stopPrice: number | null;
  targetPrice: number | null;
  orderBook: OrderBookSnapshot;
  klines1m: KlineItem[];
  volume24h?: number;
};

export type PositionReportResult = {
  signal: PositionSignal;
  report: string;
  reason: string;
  satTrigger: string | null;
};

function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "-";
  if (value >= 1000) return value.toFixed(2);
  if (value >= 10) return value.toFixed(3);
  if (value >= 1) return value.toFixed(4);
  if (value >= 0.1) return value.toFixed(5);
  return value.toFixed(6);
}

function computeMA(closes: number[], period: number): number {
  const slice = closes.slice(-period);
  return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
}

export function buildPositionReport(input: PositionReportInput): PositionReportResult {
  const { symbol, entryPrice, currentPrice, stopPrice, targetPrice, orderBook, klines1m } = input;

  const pnlPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
  const pnlStr = (pnlPercent >= 0 ? "+" : "") + pnlPercent.toFixed(2);

  // MA calculations from 1m klines
  const closes = klines1m.map((x) => x.close);
  const ma7 = computeMA(closes, 7);
  const aboveMA7 = currentPrice > ma7;

  // Order book analysis
  const bidDepth = orderBook.bids.reduce((acc, x) => acc + x.quantity * x.price, 0);
  const askDepth = orderBook.asks.reduce((acc, x) => acc + x.quantity * x.price, 0);
  const totalDepth = bidDepth + askDepth;
  const bidPct = totalDepth > 0 ? Math.round((bidDepth / totalDepth) * 100) : 50;
  const askPct = 100 - bidPct;

  // Nearest support = highest bid cluster price
  const nearestSupport = orderBook.bids[0]?.price ?? null;
  // Nearest resistance = lowest ask cluster price
  const nearestResistance = orderBook.asks[0]?.price ?? null;

  // Volume trend: compare last 2 candle volumes
  const vols = klines1m.slice(-3).map((x) => x.volume);
  const lastVol = vols[vols.length - 1] ?? 0;
  const prevVol = vols[vols.length - 2] ?? 0;
  const volumeDropPercent = prevVol > 0 ? ((lastVol - prevVol) / prevVol) * 100 : 0;
  const volumeTrendLabel = volumeDropPercent >= 10 ? "Artıyor" : volumeDropPercent <= -10 ? "Azalıyor" : "Stabil";

  // --- Evaluate SAT conditions ---
  let satTrigger: string | null = null;

  // 1. Fiyat stop seviyesinin altına kapandı
  if (stopPrice != null && currentPrice <= stopPrice) {
    satTrigger = `Fiyat stop seviyesinin altına kapandı (${formatPrice(currentPrice)} <= ${formatPrice(stopPrice)})`;
  }

  // 2. Son mum hacmi öncekine göre %50+ düştü
  if (!satTrigger && prevVol > 0 && volumeDropPercent <= -50) {
    satTrigger = `Hacim ani %${Math.abs(Math.round(volumeDropPercent))} düştü`;
  }

  // 3. Satış baskısı alışın 2 katı (askDepth >= 2x bidDepth)
  if (!satTrigger && bidDepth > 0 && askDepth >= bidDepth * 2) {
    satTrigger = `Emir defterinde satış baskısı alışın ${(askDepth / Math.max(bidDepth, 0.001)).toFixed(1)}x katına çıktı`;
  }

  // 4. Fiyat MA7'nin altına kapandı
  if (!satTrigger && ma7 > 0 && currentPrice < ma7) {
    satTrigger = `Fiyat MA7'nin altına kapandı (anlık=${formatPrice(currentPrice)}, MA7=${formatPrice(ma7)})`;
  }

  // 5. Hedef fiyata ulaşıldı
  if (!satTrigger && targetPrice != null && currentPrice >= targetPrice) {
    satTrigger = `Hedef fiyata ulaşıldı (${formatPrice(currentPrice)} >= ${formatPrice(targetPrice)})`;
  }

  // Determine signal
  let signal: PositionSignal;
  let reason: string;

  if (satTrigger) {
    signal = "SAT";
    reason = `SAT sinyali: ${satTrigger}`;
  } else if (
    (ma7 > 0 && currentPrice / ma7 < 1.002) || // fiyat MA7'ye çok yakın
    askPct >= 60 || // satış baskısı baskın
    volumeDropPercent <= -30 // hacim %30+ azalıyor
  ) {
    signal = "DİKKAT";
    const warnings: string[] = [];
    if (ma7 > 0 && currentPrice / ma7 < 1.002) warnings.push("MA7'ye çok yakın");
    if (askPct >= 60) warnings.push(`Satış baskısı %${askPct}`);
    if (volumeDropPercent <= -30) warnings.push(`Hacim %${Math.abs(Math.round(volumeDropPercent))} azalıyor`);
    reason = `Zayıflama sinyali: ${warnings.join("; ")}`;
  } else {
    signal = "TUT";
    reason = "Momentum devam ediyor" +
      (aboveMA7 ? ", MA7 üstünde" : "") +
      (targetPrice != null ? ", hedef henüz gelmedi" : "");
  }

  const ma7Status = aboveMA7 ? "Üstünde" : "Altında";

  const report = [
    `🎯 AKTİF POZİSYON: ${symbol}`,
    `Giriş: ${formatPrice(entryPrice)} → Anlık: ${formatPrice(currentPrice)} → ${pnlPercent >= 0 ? "Kâr" : "Zarar"}: %${pnlStr}`,
    "────────────────────",
    `Destek: ${formatPrice(nearestSupport)} | Direnç: ${formatPrice(nearestResistance)}`,
    `Hacim trendi: ${volumeTrendLabel}`,
    `Alış/Satış baskısı: %${bidPct} / %${askPct}`,
    `MA7 durumu: ${ma7Status}`,
    "────────────────────",
    `KARAR: ${signal}`,
    `Neden: ${reason}`,
    `Stop seviyesi: ${formatPrice(stopPrice)}`,
    `Sonraki hedef: ${formatPrice(targetPrice)}`,
  ].join("\n");

  return { signal, report, reason, satTrigger };
}
