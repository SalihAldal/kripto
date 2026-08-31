import type { MarketTradeEvent, BookTickerState } from "@/src/server/market-data/spine/events";
import type { OrderBookSnapshot } from "@/src/types/exchange";
import { median, nz, percentile } from "@/src/server/opportunity/normalize";
import type { OpportunityCandidate } from "@/src/server/opportunity/types";
import type { BookSample, MicroFeatures } from "@/src/server/microstructure/types";

const WINDOWS_MS = {
  s1: 1_000,
  s3: 3_000,
  s5: 5_000,
  s10: 10_000,
  s15: 15_000,
  s30: 30_000,
  s60: 60_000,
} as const;

function inWindow(trades: MarketTradeEvent[], now: number, ms: number) {
  const cutoff = now - ms;
  return trades.filter((row) => (row.tradeTime || row.eventTime || row.receiveTime) >= cutoff);
}

function flow(trades: MarketTradeEvent[]) {
  let buy = 0;
  let sell = 0;
  let buyCount = 0;
  let sellCount = 0;
  for (const row of trades) {
    if (row.takerSide === "BUY") {
      buy += row.quoteNotional;
      buyCount += 1;
    } else {
      sell += row.quoteNotional;
      sellCount += 1;
    }
  }
  const total = buy + sell;
  return { buy, sell, buyCount, sellCount, total };
}

function imbalance(buy: number, sell: number) {
  const total = buy + sell;
  if (total < 1) return 0;
  return (buy - sell) / total;
}

function rate(count: number, seconds: number) {
  if (seconds <= 0) return 0;
  return count / seconds;
}

function avgNotional(trades: MarketTradeEvent[]) {
  if (!trades.length) return 0;
  const sum = trades.reduce((acc, row) => acc + row.quoteNotional, 0);
  return sum / trades.length;
}

function depthNotional(levels: Array<{ price: number; quantity: number }>, mid: number, bps: number, side: "bid" | "ask") {
  if (!mid) return 0;
  const band = mid * (bps / 10_000);
  let sum = 0;
  for (const level of levels) {
    const delta = side === "bid" ? mid - level.price : level.price - mid;
    if (delta < 0 || delta > band) continue;
    sum += level.price * level.quantity;
  }
  return sum;
}

export function computeMicroFeatures(input: {
  opportunity: OpportunityCandidate;
  trades: MarketTradeEvent[];
  book: BookTickerState | null;
  depth: OrderBookSnapshot | null;
  bookHistory: BookSample[];
  intendedNotional: number;
  now?: number;
}): MicroFeatures {
  const now = input.now ?? Date.now();
  const trades = input.trades;
  const t1 = inWindow(trades, now, WINDOWS_MS.s1);
  const t3 = inWindow(trades, now, WINDOWS_MS.s3);
  const t5 = inWindow(trades, now, WINDOWS_MS.s5);
  const t15 = inWindow(trades, now, WINDOWS_MS.s15);
  const t30 = inWindow(trades, now, WINDOWS_MS.s30);
  const t60 = inWindow(trades, now, WINDOWS_MS.s60);
  const f1 = flow(t1);
  const f3 = flow(t3);
  const f5 = flow(t5);
  const f15 = flow(t15);
  const f60 = flow(t60);
  const buyRate5 = f5.buy / 5;
  const buyRate15 = f15.buy / 15;
  const buyRate60 = f60.buy / 60;
  const sellRate5 = f5.sell / 5;
  const sellRate15 = f15.sell / 15;
  const buyFlowAcceleration = buyRate5 - buyRate15;
  const sellFlowAcceleration = sellRate5 - sellRate15;
  const netFlowAcceleration = buyFlowAcceleration - sellFlowAcceleration;

  const tradeRate1s = rate(t1.length, 1);
  const tradeRate5s = rate(t5.length, 5);
  const tradeRate15s = rate(t15.length, 15);
  const tiny = t5.filter((row) => row.quoteNotional < Math.max(5, avgNotional(t60) * 0.05));
  const tinyShare = t5.length ? tiny.length / t5.length : 0;
  const tradeRateAcceleration = (tradeRate5s - tradeRate15s) * (1 - Math.min(0.85, tinyShare));

  const notionals = t60.map((row) => row.quoteNotional).filter((v) => v > 0);
  const largeThreshold = Math.max(80, percentile(notionals, 90) || median(notionals) * 3);
  const largeBuys = t15.filter((row) => row.takerSide === "BUY" && row.quoteNotional >= largeThreshold);
  const largeSells = t15.filter((row) => row.takerSide === "SELL" && row.quoteNotional >= largeThreshold);

  const book = input.book;
  const mid = book && book.bestBid > 0 && book.bestAsk > 0 ? (book.bestBid + book.bestAsk) / 2 : input.opportunity.currentPrice;
  const topBookImbalance =
    book && book.bestBidQty + book.bestAskQty > 0
      ? (book.bestBidQty - book.bestAskQty) / (book.bestBidQty + book.bestAskQty)
      : 0;

  const bids = input.depth?.bids ?? [];
  const asks = input.depth?.asks ?? [];
  const bidLiq5 = depthNotional(bids, mid, 5, "bid") || (book ? book.bestBid * book.bestBidQty : 0);
  const askLiq5 = depthNotional(asks, mid, 5, "ask") || (book ? book.bestAsk * book.bestAskQty : 0);
  const bidLiq10 = depthNotional(bids, mid, 10, "bid") || bidLiq5;
  const askLiq10 = depthNotional(asks, mid, 10, "ask") || askLiq5;
  const bidLiq25 = depthNotional(bids, mid, 25, "bid") || bidLiq10;
  const askLiq25 = depthNotional(asks, mid, 25, "ask") || askLiq10;
  const depthImbalance = (bid: number, ask: number) => (bid + ask > 1 ? (bid - ask) / (bid + ask) : topBookImbalance);

  const history = input.bookHistory;
  const lastBook = history[history.length - 1];
  const firstBook = history[0];
  const askNow = lastBook ? lastBook.askQty * lastBook.bestAsk : askLiq5;
  const askPrev = firstBook && history.length > 1 ? firstBook.askQty * firstBook.bestAsk : askNow;
  const bidNow = lastBook ? lastBook.bidQty * lastBook.bestBid : bidLiq5;
  const bidPrev = firstBook && history.length > 1 ? firstBook.bidQty * firstBook.bestBid : bidNow;
  const askDepthChange = askNow - askPrev;
  const askDepletionRate = askPrev > 0 ? Math.max(0, (askPrev - askNow) / askPrev) : 0;
  const askReloadRate = askPrev > 0 ? Math.max(0, (askNow - askPrev) / askPrev) : 0;
  const bidWithdrawal = bidPrev > 0 ? Math.max(0, (bidPrev - bidNow) / bidPrev) : 0;
  const bidReload = bidPrev > 0 ? Math.max(0, (bidNow - bidPrev) / bidPrev) : 0;
  const bidPersistence = 1 - bidWithdrawal;
  const askQtys = history.map((row) => row.askQty);
  const bidQtys = history.map((row) => row.bidQty);
  const liquidityVolatility =
    askQtys.length > 3
      ? (Math.max(...askQtys) - Math.min(...askQtys)) / Math.max(1, median(askQtys))
      : 0;
  const largeAskAppearedThenRemoved = detectPulse(askQtys);
  const largeBidAppearedThenRemoved = detectPulse(bidQtys);

  const firstPx = t15[0]?.price ?? input.opportunity.currentPrice;
  const lastPx = t15[t15.length - 1]?.price ?? input.opportunity.currentPrice;
  const priceChange = firstPx > 0 ? ((lastPx - firstPx) / firstPx) * 100 : nz(input.opportunity.features.return15s);
  const priceChangePerBuyNotional = f15.buy > 0 ? priceChange / (f15.buy / 1_000) : 0;
  const sellAbsorption = f5.buy > f5.sell * 1.2 && priceChange < 0.08 ? Math.min(1, (f5.buy - f5.sell) / Math.max(1, f5.total)) : 0;
  const buyAbsorption = f5.sell > f5.buy * 1.2 && priceChange > -0.08 ? Math.min(1, (f5.sell - f5.buy) / Math.max(1, f5.total)) : 0;

  const flowDown = f5.buy < f15.buy / 3 && priceChange > 0.15;
  const volDown = t5.length < t15.length / 4 && priceChange > 0.15;
  const askGrew = askReloadRate > 0.15 && priceChange > 0.1;
  const priceFlowDivergence = flowDown ? Math.min(1, priceChange / 2) : 0;
  const priceVolumeDivergence = volDown ? Math.min(1, priceChange / 2) : 0;
  const priceBookDivergence = askGrew ? Math.min(1, askReloadRate) : 0;

  const high = Math.max(input.opportunity.firstDetectionPrice, ...t60.map((row) => row.price), lastPx);
  const retrace = high > 0 ? ((high - lastPx) / high) * 100 : 0;
  const reachedHigh = high > input.opportunity.firstDetectionPrice * 1.001;
  const held = reachedHigh && retrace < 0.25 && imbalance(f5.buy, f5.sell) > 0.1;
  const failed = reachedHigh && retrace > 0.45 && imbalance(f5.buy, f5.sell) < 0;
  const breakoutHoldTime = held ? Math.min(15, t5.length / 4) : 0;
  const postBreakoutFlow = held ? imbalance(f5.buy, f5.sell) : failed ? imbalance(f5.buy, f5.sell) : 0;
  const breakoutRetestQuality = held ? 1 - retrace : failed ? -1 : 0;
  const failedBreakout = failed ? Math.min(1, retrace / 2 + Math.max(0, -imbalance(f5.buy, f5.sell))) : 0;
  const velocityDown = input.opportunity.features.priceAccelerationShort < 0;
  const buyRatioDrop = imbalance(f5.buy, f5.sell) < imbalance(f15.buy, f15.sell) - 0.15;
  const microExhaustion =
    (velocityDown ? 0.25 : 0) +
    (buyRatioDrop ? 0.25 : 0) +
    (tradeRateAcceleration < 0 ? 0.15 : 0) +
    (askReloadRate > 0.2 ? 0.15 : 0) +
    (priceFlowDivergence > 0.2 ? 0.15 : 0) +
    (retrace > 0.8 ? 0.2 : 0);

  const oppAccel = input.opportunity.features.priceAccelerationShort;
  const crossLayerConfirmation =
    oppAccel > 0 && imbalance(f5.buy, f5.sell) > 0.2 && tradeRateAcceleration > 0 && askDepletionRate > 0.05
      ? 1
      : oppAccel > 0 && imbalance(f5.buy, f5.sell) < 0
        ? -0.6
        : 0;

  const nearAsk = askLiq10;
  const expectedSlippageBps =
    nearAsk <= 0
      ? 80
      : input.intendedNotional / nearAsk > 0.25
        ? Math.min(120, (input.intendedNotional / nearAsk) * 80)
        : Math.min(40, book?.spreadBps ?? 8);
  const depthToIntendedSize = input.intendedNotional > 0 ? nearAsk / input.intendedNotional : 0;

  const lastTrade = trades[trades.length - 1];
  return {
    takerBuyVolume1s: f1.buy,
    takerSellVolume1s: f1.sell,
    takerBuyVolume5s: f5.buy,
    takerSellVolume5s: f5.sell,
    takerBuyVolume15s: f15.buy,
    takerSellVolume15s: f15.sell,
    takerBuyVolume60s: f60.buy,
    takerSellVolume60s: f60.sell,
    netTakerFlow5s: f5.buy - f5.sell,
    netTakerFlow15s: f15.buy - f15.sell,
    takerBuyRatio5s: f5.total > 0 ? f5.buy / f5.total : 0.5,
    takerBuyRatio15s: f15.total > 0 ? f15.buy / f15.total : 0.5,
    flowImbalance3s: imbalance(f3.buy, f3.sell),
    flowImbalance5s: imbalance(f5.buy, f5.sell),
    flowImbalance15s: imbalance(f15.buy, f15.sell),
    flowImbalance60s: imbalance(f60.buy, f60.sell),
    buyFlowAcceleration,
    sellFlowAcceleration,
    netFlowAcceleration,
    tradeRate1s,
    tradeRate5s,
    tradeRate15s,
    tradeRateAcceleration,
    avgTradeNotional5s: avgNotional(t5),
    avgTradeNotional15s: avgNotional(t15),
    avgTradeNotional60s: avgNotional(t60),
    largeBuyTradeRate: largeBuys.length / 15,
    largeSellTradeRate: largeSells.length / 15,
    largeBuyNotional: largeBuys.reduce((acc, row) => acc + row.quoteNotional, 0),
    largeSellNotional: largeSells.reduce((acc, row) => acc + row.quoteNotional, 0),
    spreadBps: book?.spreadBps ?? 0,
    spreadAbsolute: book?.spreadAbsolute ?? 0,
    topBookImbalance,
    depthImbalance5bps: depthImbalance(bidLiq5, askLiq5),
    depthImbalance10bps: depthImbalance(bidLiq10, askLiq10),
    depthImbalance25bps: depthImbalance(bidLiq25, askLiq25),
    bidLiquidity: bidLiq10,
    askLiquidity: askLiq10,
    askDepthChange,
    askDepletionRate,
    askReloadRate,
    bidPersistence,
    bidReload,
    bidWithdrawal,
    liquidityVolatility,
    largeAskAppearedThenRemoved,
    largeBidAppearedThenRemoved,
    priceChangePerBuyNotional,
    sellAbsorption,
    buyAbsorption,
    crossLayerConfirmation,
    priceFlowDivergence,
    priceVolumeDivergence,
    priceBookDivergence,
    microExhaustion: Math.min(1, microExhaustion),
    breakoutHoldTime,
    postBreakoutFlow,
    breakoutRetestQuality,
    failedBreakout,
    expectedSlippageBps,
    depthToIntendedSize,
    lastAggTradeAt: lastTrade?.receiveTime || lastTrade?.tradeTime || 0,
    lastBookTickerAt: book?.lastUpdateAt ?? 0,
    lastDepthAt: input.depth ? now : 0,
    tradeCount: trades.length,
  };
}

function detectPulse(values: number[]) {
  if (values.length < 4) return 0;
  const med = median(values);
  if (med <= 0) return 0;
  let seen = false;
  let gone = false;
  for (const value of values) {
    if (value > med * 3) seen = true;
    else if (seen && value < med * 1.2) gone = true;
  }
  return seen && gone ? 1 : 0;
}
