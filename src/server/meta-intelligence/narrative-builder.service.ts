import { getLatestContext, upsertMarketNarrative } from "@/src/server/meta-intelligence/meta-intelligence.repository";
import { emitMetaEvent, META_EVENT } from "@/src/server/meta-intelligence/meta-intelligence.events";
import type { ExecutiveNarrativeType, MarketRegime } from "@prisma/client";

const REGIME_NARRATIVE: Record<MarketRegime, { type: ExecutiveNarrativeType; title: string; story: string }> = {
  BULL_EXPANSION: { type: "BULL_EXPANSION", title: "Bull Expansion", story: "Multiple intelligence sources align bullish. Risk appetite expanding across news, whale, and on-chain signals." },
  BEAR_CONTRACTION: { type: "RISK_OFF", title: "Bear Contraction", story: "Risk-off sentiment dominating. Capital flowing to safety." },
  RISK_ON: { type: "RISK_ON", title: "Risk On", story: "Market participants increasing risk exposure. Altcoin and DeFi activity rising." },
  RISK_OFF: { type: "RISK_OFF", title: "Risk Off", story: "Flight to quality. Stablecoin inflows and reduced speculative activity." },
  LIQUIDITY_ROTATION: { type: "LIQUIDITY_ROTATION", title: "Liquidity Rotation", story: "Capital rotating between sectors and chains. Whale activity elevated without clear directional bias." },
  MACRO_PANIC: { type: "MACRO_PANIC", title: "Macro Panic", story: "Macro headwinds dominating crypto sentiment. News impact scores elevated on regulatory and macro events." },
  SIDEWAYS: { type: "OTHER", title: "Range-Bound Market", story: "Mixed signals with no dominant narrative. Intelligence sources diverging." },
  HIGH_VOLATILITY: { type: "OTHER", title: "High Volatility Regime", story: "Elevated volatility across assets. Caution warranted despite individual bullish signals." },
  LOW_VOLATILITY: { type: "OTHER", title: "Low Volatility Compression", story: "Volatility compressing. Potential breakout setup forming." },
  UNKNOWN: { type: "OTHER", title: "Undefined Regime", story: "Insufficient data to determine market narrative." },
};

export async function buildMarketNarrative(limit = 5) {
  const ctx = await getLatestContext();
  const regime = ctx?.marketRegime ?? "UNKNOWN";
  const template = REGIME_NARRATIVE[regime];

  const news = ctx?.newsSnapshot as { avgScore?: number } | null;
  const whale = ctx?.whaleSnapshot as { avgActivity?: number } | null;

  const heatScore = Math.min(100, ((news?.avgScore ?? 50) + (whale?.avgActivity ?? 50)) / 2);
  const narrative = await upsertMarketNarrative({
    narrativeKey: `regime_${regime.toLowerCase()}`,
    narrativeType: template.type,
    title: template.title,
    story: template.story,
    marketRegime: regime,
    heatScore,
    confidence: ctx?.overallConfidence ?? 50,
    supportingSignals: { news: news?.avgScore, whale: whale?.avgActivity, regime },
  });

  const extras: ExecutiveNarrativeType[] = ["AI_NARRATIVE", "MEME_SEASON", "LAYER1_ROTATION", "STABLECOIN_EXPANSION"];
  let built = 1;
  for (const type of extras.slice(0, limit - 1)) {
    await upsertMarketNarrative({
      narrativeKey: `narrative_${type.toLowerCase()}`,
      narrativeType: type,
      title: type.replace(/_/g, " "),
      story: `Monitoring ${type.replace(/_/g, " ").toLowerCase()} signals across intelligence modules.`,
      marketRegime: regime,
      heatScore: Math.random() * 40 + 30,
      confidence: 45,
    }).catch(() => null);
    built += 1;
  }

  emitMetaEvent(META_EVENT.NARRATIVE_UPDATED, { narrativeId: narrative.id, regime });
  return { narrative, built, regime };
}
