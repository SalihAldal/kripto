import type {
  ChainType,
  FlowDirection,
  RotationType,
  SmartMoneyPatternType,
  WalletTagType,
  WhaleAlertType,
  WhaleIntelligenceJobType,
  WhaleTransactionType,
} from "@prisma/client";

export type WhaleIntelligenceJobPayload =
  | { type: "WHALE_DETECT"; limit?: number }
  | { type: "WALLET_MONITOR"; limit?: number }
  | { type: "EXCHANGE_FLOW"; exchange?: string; limit?: number }
  | { type: "STABLECOIN_FLOW"; limit?: number }
  | { type: "FLOW_CALCULATE"; limit?: number }
  | { type: "WHALE_SCORE"; walletId?: string; limit?: number }
  | { type: "LIQUIDITY_ROTATION"; limit?: number }
  | { type: "PATTERN_DETECT"; limit?: number }
  | { type: "REPLAY_ANALYZE"; transactionId?: string; limit?: number }
  | { type: "INSTITUTIONAL_LEARN"; limit?: number }
  | { type: "ALERT_GENERATE"; limit?: number };

export type DetectedWhaleEvent = {
  chain: ChainType;
  txType: WhaleTransactionType;
  direction: FlowDirection;
  asset: string;
  amount: number;
  amountUsd: number;
  exchange?: string;
  fromAddress?: string;
  toAddress?: string;
  walletAddress?: string;
  walletTag?: WalletTagType;
  confidence?: number;
  sourceReliability?: number;
};

export type WhaleScoreResult = {
  whaleActivityScore: number;
  accumulationScore: number;
  distributionScore: number;
  confidence: number;
  expectedImpact: number;
  sourceReliability: number;
  historicalAccuracy: number;
  falseSignalProb: number;
};

export type FlowSummary = {
  netBuyFlowUsd: number;
  netSellFlowUsd: number;
  exchangeInflowUsd: number;
  exchangeOutflowUsd: number;
  stablecoinInflowUsd: number;
  stablecoinOutflowUsd: number;
  accumulationUsd: number;
  distributionUsd: number;
};

export const DEFAULT_EXCHANGES = ["BINANCE", "BYBIT", "OKX", "GATE", "MEXC", "COINBASE", "KRAKEN"] as const;

export const DEFAULT_WALLETS: Array<{
  address: string;
  chain: ChainType;
  label: string;
  tagType: WalletTagType;
  exchange?: string;
  entityName?: string;
}> = [
  { address: "0xbinance_hot_1", chain: "ETHEREUM", label: "Binance Hot Wallet 1", tagType: "EXCHANGE", exchange: "BINANCE" },
  { address: "0xbybit_hot_1", chain: "ETHEREUM", label: "Bybit Hot Wallet 1", tagType: "EXCHANGE", exchange: "BYBIT" },
  { address: "0xokx_hot_1", chain: "ETHEREUM", label: "OKX Hot Wallet 1", tagType: "EXCHANGE", exchange: "OKX" },
  { address: "0xwhale_btc_1", chain: "BITCOIN", label: "Known BTC Whale", tagType: "WHALE", entityName: "Whale Alpha" },
  { address: "0xsmart_money_1", chain: "ETHEREUM", label: "Smart Money Wallet", tagType: "SMART_MONEY", entityName: "Alpha Fund" },
  { address: "0xfund_grayscale", chain: "ETHEREUM", label: "Grayscale Fund", tagType: "FUND", entityName: "Grayscale" },
  { address: "0xfoundation_eth", chain: "ETHEREUM", label: "ETH Foundation", tagType: "FOUNDATION", entityName: "Ethereum Foundation" },
  { address: "0xtreasury_sol", chain: "SOLANA", label: "Solana Treasury", tagType: "TREASURY", entityName: "Solana Labs" },
  { address: "0xvc_a16z", chain: "ETHEREUM", label: "a16z Crypto", tagType: "VC", entityName: "a16z" },
  { address: "0xmm_jane_street", chain: "ETHEREUM", label: "Jane Street MM", tagType: "MARKET_MAKER", entityName: "Jane Street" },
];

export const SAMPLE_ASSETS = ["BTC", "ETH", "SOL", "USDT", "USDC", "BNB", "ARB", "OP", "AVAX", "MATIC"];

export const WHALE_EVENT = {
  TRANSACTION_DETECTED: "WhaleTransactionDetected",
  WALLET_TAGGED: "WhaleWalletTagged",
  FLOW_CALCULATED: "WhaleFlowCalculated",
  SCORE_COMPUTED: "WhaleScoreComputed",
  PATTERN_DETECTED: "SmartMoneyPatternDetected",
  ALERT_TRIGGERED: "WhaleAlertTriggered",
  REPLAY_COMPLETED: "WhaleReplayCompleted",
  ROTATION_DETECTED: "LiquidityRotationDetected",
} as const;

export type { ChainType, FlowDirection, RotationType, SmartMoneyPatternType, WalletTagType, WhaleAlertType, WhaleIntelligenceJobType, WhaleTransactionType };
