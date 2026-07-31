# Enterprise AI Trade Architecture (Kurumsal Seviye)

Bu dokuman mevcut sistemdeki tum AI modullerinin kurumsal, aciklanabilir, disiplinli ve secici bir trade mimarisi olarak nasil calistigini tek yerde toplar.

## 1) Final AI Mimarisi

### Uzman AI Rolleri

- AI-1 Teknik Analiz Uzmani  
  - Dosya: `src/server/ai/providers/provider-1.adapter.ts`
  - Gorev: teknik setup kalitesi, MTF uyumu, likidite tuzaklari, entry/TP/SL teknik uygunlugu.

- AI-2 Haber/Momentum/Piyasa Baglami Uzmani  
  - Dosya: `src/server/ai/providers/provider-2.adapter.ts`
  - Gorev: momentum kalitesi, sentiment, haber bias, hype/organik guc ayrimi.

- AI-3 Risk Yoneticisi / Veto Motoru  
  - Dosya: `src/server/ai/providers/provider-3.adapter.ts`
  - Gorev: risk exposure, portfolio guvenligi, order guvenligi, veto/caution/approve.

### Destekleyici Cekirdek Katmanlar

- Market regime engine: `src/server/scanner/market-regime.service.ts`
- Multi-timeframe framework: `src/server/ai/multi-timeframe.service.ts`
- Liquidity/stop-hunt/fake-breakout: `src/server/ai/indicator-suite.ts`
- Trade quality scoring: `src/server/execution/signal-quality-gate.service.ts`
- Smart entry engine: `src/server/execution/smart-entry-engine.service.ts`
- Smart exit engine: `src/server/execution/smart-exit-engine.service.ts`
- No-trade mode: `src/server/ai/hybrid-decision-engine.ts`
- Consensus engine: `src/server/ai/hybrid-decision-engine.ts`
- Self-critic review: `src/server/ai/hybrid-decision-engine.ts`
- Controlled performance memory: `src/server/metrics/self-optimization.service.ts`
- Standardized AI outputs: `src/server/ai/providers/standardized-output.ts`

## 2) Modul Modul Servis Yapisi

- AI orchestration giris noktasi: `src/server/ai/analysis-orchestrator.ts`
- Hybrid consensus + karar: `src/server/ai/hybrid-decision-engine.ts`
- Execution flow ve tek pozisyon disiplini: `src/server/execution/execution-orchestrator.service.ts`
- Acik pozisyon izleme (entry durdur, exit odakli izleme): `src/server/execution/position-monitor.service.ts`
- Settlement ve kapanis: `src/server/execution/post-trade-settlement.service.ts`

## 3) Final Islem Akisi (Canli Entegre)

1. Kullanici analiz baslatir (`executeAnalyzeAndTrade`)
2. Market regime belirlenir (`buildMarketContext` + `detectMarketRegime`)
3. Coin taramasi yapilir (`runScannerPipeline`)
4. AI-1 teknik degerlendirme yapar
5. AI-2 momentum/haber degerlendirme yapar
6. AI-3 risk/veto degerlendirme yapar
7. Trade quality score hesaplanir (`evaluateSignalQualityGate`)
8. Smart entry logic giris kalitesini dogrular (`evaluateSmartEntryEngine`)
9. Consensus engine final karar verir (`consensusEngine.finalDecision`)
10. Self-critic son kontrol yapar (`selfCriticReview`)
11. Kalite + risk + consensus yeterliyse trade acilir
12. Acik pozisyon varken yeni tarama/acilis engellenir
13. Sadece smart-exit kosullari izlenir (`evaluateSmartExitEngine`)
14. Pozisyon kapaninca yeni analiz dongusu tekrar baslar

## 4) Scoring ve Decision Engine Ozeti

- Hybrid role score agirliklari:
  - Teknik: yuksek agirlik
  - Sentiment: orta agirlik
  - Risk: veto etkili koruyucu agirlik
- Trade quality gate: 10 kriterli agirlikli skor + confidence tier + decision.
- Adaptive/performance memory:
  - coin/saat/strateji/setup + regime-strategy + entry/exit pattern confidence
  - bayesian shrinkage + sample weight + bounded influence (anti-overfit)

## 5) Veto ve No-Trade Mantigi

- AI-3 veto varsa BUY acilmaz.
- Market rejim force skip, asiri volatilite, dusuk hacim, fake breakout, RR bozukluk, gec giris gibi durumlar no-trade/reject sebebidir.
- No-trade ciktilari:
  - `reasonList`
  - `blockedByAi`
  - `retryLaterSuggestion`
  - `marketNotSuitableSummary`

## 6) Standardized AI Output Contract

Tum providerlar makinece islenebilir ortak yapi uretir:

```json
{
  "symbol": "BTCTRY",
  "timestamp": "2026-04-21T12:00:00.000Z",
  "timeframeContext": {
    "higher": "BULLISH (conf=74)",
    "mid": "TREND_CONTINUATION/BULLISH",
    "lower": "HIGH",
    "alignmentSummary": "Timeframes aligned"
  },
  "coreThesis": "Trend continuation with liquidity clearance.",
  "bullishFactors": ["Momentum supportive", "Volume confirmation"],
  "bearishFactors": ["News uncertainty"],
  "confidenceScore": 78.2,
  "riskFlags": ["elevated_spread"],
  "noTradeTriggers": [],
  "recommendedAction": "BUY",
  "explanationSummary": "Setup valid with controlled risk."
}
```

## 7) Ornek Senaryolar

### BUY
- Rejim uygun, MTF uyumlu, teknik guclu, momentum destekli, AI-3 veto yok, quality yuksek.
- Consensus: `BUY`
- Self-critic: `APPROVED`

### WATCHLIST
- Teknik guclu ama haber/momentum teyidi yetersiz veya kalite marjda.
- Consensus: `WATCHLIST`
- Self-critic: `DOWNGRADED_WATCHLIST`

### NO-TRADE
- Belirsizlik, timeframe cakisimi, momentum zayif, haber karmasik.
- Consensus: `NO-TRADE`
- No-trade mode reason list dolu.

### REJECT
- AI-3 veto, asiri risk, fake breakout riski yuksek, RR bozuk.
- Consensus: `REJECT`
- Self-critic/consensus veto status aktif.

## 8) Mevcut Sisteme Tam Entegrasyon Kodu (Uygulama Referansi)

Final entegrasyon asagidaki mevcut zincirde aktif:

- AI input + role analysis: `runAIConsensusFromInput` (`src/server/ai/analysis-orchestrator.ts`)
- Hybrid consensus + no-trade + self-critic: `buildHybridDecision` (`src/server/ai/hybrid-decision-engine.ts`)
- Execution quality/adaptive/smart-entry gate: `executeAnalyzeAndTrade` (`src/server/execution/execution-orchestrator.service.ts`)
- Open position smart-exit monitor: `startPositionMonitor` (`src/server/execution/position-monitor.service.ts`)

Kritik davranis:

- Acik pozisyon varken yeni analiz/trade engeli aktif.
- Risk yonetimi her zaman ust katman.
- Tek indikator/tek haber ile karar acilmaz.
- Her karar aciklanabilir payload ve event context ile loglanir.

## 9) Disiplin Prensibi

Sistem agresif degil secici calisir:

- Kalite yetersizse acmaz
- Belirsizlikte bekler
- Veto varsa zorlamaz
- Pozisyon acildiginda yeni av yerine cikis yonetimine odaklanir

Bu yapiyla bot rastgele firsat kovalayan bir yapi degil; kurumsal seviyede cok katmanli, savunmali ve aciklanabilir bir trade analiz motoru olarak calisir.
