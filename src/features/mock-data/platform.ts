import type {
  AIModelCard,
  NotificationItem,
  OrderBookRow,
  ScannerRow,
  SummaryCard,
  TradeHistoryRow,
} from "@/src/types/platform";

export const summaryCards: SummaryCard[] = [
  { key: "system", label: "System Status", value: "OPERATIONAL", tone: "secondary" },
  { key: "models", label: "AI Models", value: "3 Active", delta: "+1 tuned", tone: "primary" },
  { key: "open", label: "Open Trades", value: "4", delta: "Limit 10", tone: "primary" },
  { key: "pnl", label: "Total PnL", value: "+$24,250", delta: "+3.8% 24h", tone: "secondary" },
];

export const scannerRows: ScannerRow[] = [
  { symbol: "BTCUSDT", price: 64231.5, change24h: 2.45, volume24h: 1280000000, aiScore: 92 },
  { symbol: "ETHUSDT", price: 3450.2, change24h: 1.21, volume24h: 680000000, aiScore: 81 },
  { symbol: "SOLUSDT", price: 142.11, change24h: 3.94, volume24h: 220000000, aiScore: 88 },
  { symbol: "BNBUSDT", price: 612.45, change24h: -0.42, volume24h: 190000000, aiScore: 64 },
];

export const aiModelCards: AIModelCard[] = [
  {
    id: "model-a",
    model: "Neural Scalper",
    signal: "BUY",
    confidence: 0.92,
    reason: "Order flow imbalance long tarafi destekliyor.",
  },
  {
    id: "model-b",
    model: "Sentiment Synapse",
    signal: "HOLD",
    confidence: 0.76,
    reason: "Sosyal duygu verisi karisik, net break bekleniyor.",
  },
  {
    id: "model-c",
    model: "Macro Architect",
    signal: "BUY",
    confidence: 0.84,
    reason: "Makro trend yukari yonu koruyor.",
  },
];

export const orderBookRows: OrderBookRow[] = [
  { side: "ask", price: 64235.1, amount: 0.421, total: 27000 },
  { side: "ask", price: 64234.5, amount: 1.102, total: 70800 },
  { side: "ask", price: 64232, amount: 5.45, total: 350100 },
  { side: "bid", price: 64231.5, amount: 8.201, total: 526700 },
  { side: "bid", price: 64230.8, amount: 2.15, total: 138100 },
  { side: "bid", price: 64229, amount: 0.88, total: 56500 },
];

export const notifications: NotificationItem[] = [
  {
    id: "n1",
    title: "High Conviction Signal",
    description: "SOLUSDT icin 90% ustu confidence BUY sinyali.",
    level: "success",
    time: "2m ago",
  },
  {
    id: "n2",
    title: "Risk Warning",
    description: "ETHUSDT volatilite 2.4% seviyesine cikti.",
    level: "warning",
    time: "9m ago",
  },
  {
    id: "n3",
    title: "System Info",
    description: "Redis cache yeniden baglandi, queue saglikli.",
    level: "info",
    time: "13m ago",
  },
];

export const tradeHistoryRows: TradeHistoryRow[] = [
  {
    id: "t1",
    time: "14:22:08.432",
    symbol: "BTCUSDT",
    side: "LONG",
    entry: 64231.5,
    exit: 64510.22,
    duration: "42.8s",
    pnlPercent: 0.43,
    pnl: 1402.1,
  },
  {
    id: "t2",
    time: "14:18:12.109",
    symbol: "ETHUSDT",
    side: "SHORT",
    entry: 3450.2,
    exit: 3458.11,
    duration: "12.5s",
    pnlPercent: -0.23,
    pnl: -840.45,
  },
  {
    id: "t3",
    time: "14:15:55.901",
    symbol: "SOLUSDT",
    side: "LONG",
    entry: 142.11,
    exit: 144.5,
    duration: "104.2s",
    pnlPercent: 1.68,
    pnl: 5110,
  },
];
