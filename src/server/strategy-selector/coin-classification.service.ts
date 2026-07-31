import { prisma } from "@/src/server/db/prisma";
import type { CoinClassificationType } from "@prisma/client";

function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function classifyCoin(symbol: string): Promise<CoinClassificationType> {
  const sym = symbol.toUpperCase();
  const pair = await prisma.tradingPair.findFirst({ where: { symbol: sym }, select: { id: true, createdAt: true, metadata: true } }).catch(() => null);
  const snapshot = await prisma.marketSnapshot.findFirst({ where: { symbol: sym }, orderBy: { snapshotAt: "desc" } }).catch(() => null);

  const marketCap = num(snapshot?.marketCap);
  const ageDays = pair ? (Date.now() - pair.createdAt.getTime()) / 86400_000 : 999;
  const meta = (pair?.metadata ?? snapshot?.metadata) as Record<string, unknown> | null;
  const sector = String(meta?.sector ?? meta?.category ?? "").toUpperCase();

  if (sym.includes("USD") || sym.endsWith("USDT") && ["USDT", "USDC", "BUSD", "DAI"].some((s) => sym.startsWith(s))) return "STABLECOIN";
  if (ageDays < 14) return "NEW_LISTING";
  if (sector.includes("MEME") || sym.includes("DOGE") || sym.includes("PEPE") || sym.includes("SHIB")) return "MEME_COIN";
  if (sector.includes("AI") || sym.includes("AI") || sym.includes("FET") || sym.includes("AGIX")) return "AI_COIN";
  if (sector.includes("DEFI")) return "DEFI";
  if (sector.includes("GAME")) return "GAMING";
  if (sector.includes("RWA")) return "RWA";
  if (sector.includes("L2") || sector.includes("LAYER2")) return "LAYER2";
  if (sector.includes("L1") || sector.includes("LAYER1") || ["BTC", "ETH", "SOL", "AVAX", "ADA", "DOT"].some((b) => sym.startsWith(b))) return "LAYER1";
  if (sector.includes("INFRA")) return "INFRASTRUCTURE";

  if (marketCap > 10_000_000_000) return "LARGE_CAP";
  if (marketCap > 1_000_000_000) return "MID_CAP";
  if (marketCap > 100_000_000) return "LOW_CAP";
  if (marketCap > 0) return "MICRO_CAP";
  return "MID_CAP";
}
