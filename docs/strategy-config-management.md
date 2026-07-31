# Merkezi Strateji ve Ayar Yonetimi

Bu modul ile kritik trade kurallari kod degistirmeden panelden yonetilir.

## Yonetilen Alanlar

1. Islem ayarlari
- islem basina butce
- maksimum acik pozisyon
- hedef kar / stop-loss
- trailing stop
- maksimum bekleme
- cooldown
- ayni coin tekrar alim izni

2. AI ayarlari
- ai score threshold
- teknik minimum skor
- haber minimum skor
- risk veto seviyesi
- consensus minimum skor
- no-trade esigi

3. Oto tur
- toplam tur
- tur arasi bekleme
- basarisiz tur davranisi
- zarar/kar sonrasi devam veya dur

4. Coin filtreleri
- yasakli/izinli coin listesi
- minimum hacim
- maksimum spread
- maksimum volatilite

5. Rapor ayarlari
- varsayilan tarih filtresi
- export formatlari
- komisyon dahil/haric

## Teknik Yapi

Servis: `src/server/config/strategy-config.service.ts`

- Validation: Zod schema
- Versionlama:
  - aktif config: `strategy.config.active`
  - version counter: `strategy.config.version_counter`
  - tum versiyonlar: `strategy.config.version.{n}`
- Cache: memory cache (TTL 45 sn)
- Rollback: eski versiyonu yeni versiyon olarak tekrar publish eder

## API Endpointleri

- `GET /api/strategy/config`
- `PUT /api/strategy/config`
- `GET /api/strategy/config/versions`
- `POST /api/strategy/config/rollback`

## Audit ve Guvenlik

- Her update/rollback `AuditLog` tablosuna yazilir
- Gecersiz payload kaydedilmez (`422`)
- Token kontrolu ve rate-limit aktif

## Ornek Config Kaydi

```json
{
  "version": 7,
  "updatedAt": "2026-04-21T18:10:00.000Z",
  "updatedBy": "cm123...",
  "note": "panel_update",
  "config": {
    "trade": {
      "budgetPerTradeTry": 1000,
      "maxOpenPositions": 1,
      "targetProfitPercent": 2,
      "stopLossPercent": 1,
      "trailingStopEnabled": true,
      "maxWaitSec": 900,
      "cooldownSec": 900,
      "allowSameCoinReentry": false
    },
    "ai": {
      "aiScoreThreshold": 70,
      "technicalMinScore": 58,
      "newsMinScore": 52,
      "riskVetoLevel": 75,
      "consensusMinScore": 62,
      "noTradeThreshold": 45
    },
    "autoRound": {
      "totalRounds": 10,
      "waitBetweenRoundsSec": 5,
      "onRoundFailure": "continue",
      "onLoss": "continue",
      "onProfit": "continue"
    },
    "coinFilter": {
      "bannedCoins": [],
      "allowedCoins": [],
      "minVolume24h": 800000,
      "maxSpreadPercent": 0.25,
      "maxVolatilityPercent": 3.4
    },
    "report": {
      "defaultDateRange": "weekly",
      "exportFormats": ["csv", "json"],
      "includeCommission": true
    }
  }
}
```
