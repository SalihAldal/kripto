import type { DiscoveryAssetClass } from "@prisma/client";
import type { UniverseSymbol } from "@/src/server/discovery/discovery.types";
import type { MarketContext } from "@/src/types/scanner";

const MEME_BASES = new Set(["DOGE", "SHIB", "PEPE", "FLOKI", "BONK", "WIF", "MEME", "BOME", "NEIRO"]);
const AI_BASES = new Set(["FET", "AGIX", "RNDR", "TAO", "WLD", "ARKM", "AI", "OCEAN", "NMR", "GRT"]);
const LAYER1_BASES = new Set(["BTC", "ETH", "SOL", "BNB", "ADA", "AVAX", "DOT", "NEAR", "SUI", "APT", "SEI", "TON"]);
const LAYER2_BASES = new Set(["ARB", "OP", "MATIC", "POL", "IMX", "STRK", "MANTA", "ZK", "METIS"]);
const DEFI_BASES = new Set(["UNI", "AAVE", "MKR", "CRV", "COMP", "SNX", "SUSHI", "CAKE", "JUP", "PENDLE"]);
const GAMEFI_BASES = new Set(["AXS", "SAND", "MANA", "GALA", "ILV", "PIXEL", "PORTAL", "BEAMX"]);
const RWA_BASES = new Set(["ONDO", "MPL", "CFG", "POLYX", "TRU", "RIO", "PROPS"]);
const DEPIN_BASES = new Set(["FIL", "AR", "HNT", "IO", "AKT", "RNDR", "THETA"]);
const ORACLE_BASES = new Set(["LINK", "BAND", "API3", "TRB", "UMA"]);
const PRIVACY_BASES = new Set(["XMR", "ZEC", "SCRT", "ROSE"]);
const PAYMENTS_BASES = new Set(["XRP", "XLM", "LTC", "BCH", "DASH"]);
const DEX_BASES = new Set(["UNI", "SUSHI", "CAKE", "JUP", "DYDX", "GMX"]);
const CEX_BASES = new Set(["BNB", "OKB", "KCS", "GT", "CRO"]);
const STABLE_BASES = new Set(["USDT", "USDC", "DAI", "FDUSD", "TUSD", "USDE"]);
const ETF_BASES = new Set(["BTC", "ETH"]);
const BTC_ECO = new Set(["STX", "ORDI", "SATS", "RIF", "CKB"]);
const ETH_ECO = new Set(["LDO", "RPL", "SSV", "EIGEN", "ETHFI"]);
const SOL_ECO = new Set(["JUP", "RAY", "PYTH", "JTO", "WIF", "BONK"]);
const BSC_ECO = new Set(["CAKE", "XVS", "ALPACA", "BSW"]);

function baseFrom(input: { symbol: string; context?: MarketContext; universeMeta?: UniverseSymbol }) {
  const fromMeta = input.universeMeta?.baseAsset?.toUpperCase();
  if (fromMeta) return fromMeta;
  const symbol = input.symbol.toUpperCase();
  if (symbol.endsWith("USDT")) return symbol.slice(0, -4);
  if (symbol.endsWith("USDC")) return symbol.slice(0, -4);
  return symbol;
}

export function classifyAsset(input: {
  symbol: string;
  context?: MarketContext;
  universeMeta?: UniverseSymbol;
}): DiscoveryAssetClass {
  const base = baseFrom(input);
  const zone = input.universeMeta?.zone?.toUpperCase() ?? "";

  if (STABLE_BASES.has(base)) return "STABLE";
  if (zone.includes("MEME") || MEME_BASES.has(base)) return "MEME";
  if (zone.includes("AI") || AI_BASES.has(base)) return "AI";
  if (zone.includes("RWA") || RWA_BASES.has(base)) return "RWA";
  if (zone.includes("DEPIN") || DEPIN_BASES.has(base)) return "DEPIN";
  if (GAMEFI_BASES.has(base)) return "GAMEFI";
  if (DEFI_BASES.has(base)) return "DEFI";
  if (LAYER2_BASES.has(base)) return "LAYER2";
  if (LAYER1_BASES.has(base)) return "LAYER1";
  if (ORACLE_BASES.has(base)) return "ORACLE";
  if (PRIVACY_BASES.has(base)) return "PRIVACY";
  if (PAYMENTS_BASES.has(base)) return "PAYMENTS";
  if (DEX_BASES.has(base)) return "DEX";
  if (CEX_BASES.has(base)) return "CEX_TOKEN";
  if (BTC_ECO.has(base)) return "BITCOIN_ECOSYSTEM";
  if (ETH_ECO.has(base)) return "ETHEREUM_ECOSYSTEM";
  if (SOL_ECO.has(base)) return "SOLANA_ECOSYSTEM";
  if (BSC_ECO.has(base)) return "BSC_ECOSYSTEM";
  if (ETF_BASES.has(base) && (input.context?.metadata?.etfRelated || zone.includes("ETF"))) return "ETF_RELATED";

  const metadataClass = String(input.context?.metadata?.assetClass ?? "").toUpperCase();
  if (metadataClass.includes("AI_AGENT")) return "AI_AGENT";
  if (metadataClass.includes("INFRA")) return "INFRASTRUCTURE";

  return "UNKNOWN";
}
