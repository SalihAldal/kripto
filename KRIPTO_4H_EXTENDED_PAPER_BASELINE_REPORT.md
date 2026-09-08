# KRIPTO — 4 Saat Extended PAPER Strategy Baseline Raporu (Erken Durdurma)

> **Campaign:** `paper-4h-2026-09-07T19-59-48-598Z`  
> **Job:** `cmtrnzzb7000bunh8fv6ok9me`  
> **HEAD:** `fbf5c721f17cb903517fccc626b7ac7eb07984f4`  
> **Mod:** `CURRENT_STRATEGY_BASELINE` (threshold değiştirilmedi)  
> **Durum:** Manuel erken durdurma (~82 dk / planlanan 240 dk)  
> **Üretim:** 2026-09-08

---

## 1. Executive Summary

| Alan | Sonuç |
|------|-------|
| **FORMAL_CAMPAIGN_VERDICT** | **PARTIAL** (erken durdurma — tam 4h tamamlanmadı) |
| **INFRASTRUCTURE_VERDICT** | **HEALTHY** ✅ |
| **STRATEGY_BEHAVIOR_VERDICT** | **HIGHLY_SELECTIVE** (0 AI BUY, 0 trade) |
| **PIPELINE_VERDICT** | **HEALTHY** (kline + provider + handoff çalışıyor) |
| **ACCOUNTING_VERDICT** | **PASS** |
| **PROFITABILITY** | **INSUFFICIENT_DATA** (0 closed trade) |
| **READY_FOR_8H_PAPER (infra)** | **true** |
| **READY_FOR_8H_PAPER (formal)** | **false** (4h tamamlanmadı) |

**Tek cümle:** Sistemde **kritik teknik bug görülmüyor**. Pipeline sağlıklı; trade çıkmaması **strateji/AI seçiciliği** (dominant gate: `AI_NO_TRADE`). **8 saatlik full PAPER koşusu teknik olarak başlatılabilir.**

---

## 2. Runtime & Güvenlik

| Parametre | Değer |
|-----------|-------|
| Başlangıç | 2026-09-07T19:59:54Z (~22:59 TR) |
| Bitiş (manuel) | 2026-09-07T21:22Z (~00:22 TR) |
| **Gerçek runtime** | **~82 dakika** |
| Planlanan | 240 dakika |
| `EXECUTION_MODE` | paper |
| `LIVE_TRADING_ENABLED` | false |
| `LIVE_AUTHORIZATION` | DISABLED |
| Job final status | STOPPED (manuel durdurma) |
| `reachedTerminal` | true |

---

## 3. Funnel Özeti

```text
rounds=10
selected=4 (40% of rounds)
handoff_valid=4/4 (100% of selected)
fresh_kline=4/4 (100%)
NO_ELIGIBLE=5 rounds (selection timeout ~10-12dk)

AI BUY=0 | AI SELL=0 | AI NO_TRADE=4 | AI ERROR=0

entry_quality_pass=0 (AI BUY olmadığı için N/A)
risk/sizing=0 (execution'a ulaşmadı)

orders=0 | fills=0 | positions_opened=0 | positions_closed=0
```

### Conversion oranları

| Metrik | % |
|--------|---|
| Selected / Rounds | 40% |
| AI BUY / Selected | **0%** |
| Orders / Selected | 0% |
| Trades / Selected | 0% |

---

## 4. Selected Candidate Forensic (4/4)

| Round | Symbol | Kline | Provider | AI Decision | Conf | Risk | Terminal |
|-------|--------|-------|----------|-------------|------|------|----------|
| 2 | WLFIUSDT | 80 fresh, REST recovery | 3/3 ok, 3 outputs | NO_TRADE | 42.59 | 68.78 | AI_NO_TRADE |
| 3 | ZKCUSDT | 80 fresh, REST recovery | 3/3 ok, 2 outputs | NO_TRADE | 30.05 | 78.97 | AI_NO_TRADE |
| 4 | STRKTRY | 80 fresh, REST recovery | 3/3 ok, 2 outputs | NO_TRADE | 58.86 | 58.47 | AI_NO_TRADE |
| 8 | FILUSDT | 80 fresh, REST recovery | 3/3 ok, 2 outputs | NO_TRADE | 61.23 | 51.03 | AI_NO_TRADE |

**Ortak red pattern (execution gate):**
- `AI_NO_TRADE` — sinyal çakışması, düşük hacim, AI güven < 55
- Entry-quality `%82` gate'e **hiç ulaşılmadı** (AI BUY=0)
- `Kline data missing or stale` **0 event** ✅

---

## 5. AI Consensus Dağılımı

| Metrik | Değer |
|--------|-------|
| Provider attempts | 12 |
| Provider successes | 12 |
| Provider failures | 0 |
| Provider outputs | 9 |
| Real consensus count | 4 |

### Confidence (NO_TRADE only)

| Bucket | Count |
|--------|-------|
| 30-44 | 2 |
| 55-69 | 2 |
| 70-81 | 0 |
| 82-89 | 0 |

### AI Risk (NO_TRADE)

| Bucket | Count |
|--------|-------|
| 51-75 | 3 |
| 76-90 | 1 |

**Yorum:** AI consensus gerçekten çalışıyor ama karar hep NO_TRADE. Confidence çoğunlukla 55 altı veya risk yüksek — mevcut threshold'larla BUY üretmiyor.

---

## 6. Kline Health

| Metrik | Değer |
|--------|-------|
| Fresh inputs | 4/4 |
| Refresh attempts | 4 |
| Refresh successes | 4 |
| Refresh failures | 0 |
| Stale rejects | **0** |
| **freshKlineRate** | **100%** |

Kline pipeline fix'i regression göstermiyor. REST recovery çalışıyor, rate-limit (429/418) yok.

---

## 7. Rejection Histogram

| Gate | Count | % Selected |
|------|-------|------------|
| **AI_NO_TRADE** | 4 | 100% |
| ENTRY_QUALITY | 0 | — |
| RISK | 0 | — |
| SIZING | 0 | — |

### NO_ELIGIBLE (selection — selected değil)

5 round selection timeout ile bitti (`NO_ELIGIBLE_CANDIDATE`). Bu **selected rejection değil** — piyasada uygun aday bulunamadı (~600s max wait).

---

## 8. Accounting

| | TRY |
|---|-----|
| Cash before | 99,997.997 |
| Cash after | 99,997.997 |
| Realized PnL | 0 |
| Fees | 0 |
| Reconciled | **PASS** |

Campaign isolation: **PASS** (foreign orders=0, foreign trades=0)

---

## 9. Runtime / Infrastructure Health

| Metrik | Count |
|--------|-------|
| HTTP 429 | 0 |
| HTTP 418 | 0 |
| WS reconnect | 0 |
| AI timeout | 0 |
| AI parse failure | 0 |
| DB errors | 0 |
| Worker errors | 0 |
| Order/fill errors | 0 |

---

## 10. Profitability

| Metrik | Değer |
|--------|-------|
| Closed trades | 0 |
| Win rate | N/A |
| Net PnL | 0 |
| Expectancy | N/A |
| Sample verdict | **INSUFFICIENT_DATA** |

---

## 11. Sistemde Sorun Var mı?

### ❌ Bug / Blocker DEĞİL

| Kontrol | Durum |
|---------|-------|
| Canonical handoff | ✅ 4/4 |
| Kline stale regression | ✅ Yok |
| Provider consensus | ✅ 12/12 success |
| Paper accounting | ✅ PASS |
| Campaign isolation | ✅ PASS |
| LIVE trading | ✅ Kapalı |
| Rate limit | ✅ Temiz |

### ⚠️ Strateji Davranışı (beklenen baseline)

| Gözlem | Açıklama |
|--------|----------|
| AI BUY = 0 | Strateji bu pencerede hiç alım onayı vermedi |
| Dominant gate AI_NO_TRADE | Entry-quality/risk/sizing'e hiç gelmedi |
| NO_ELIGIBLE %50 | Seçim penceresinde aday yok — market sakin veya scanner seçici |
| 0 trade | **Bug değil** — funnel AI katmanında kapanıyor |

---

## 12. 8 Saat / 12 Saat Kararı

### ✅ 8 saatlik PAPER — **ÖNERİLİR (teknik)**

Gerekçe:
- Altyapı 82 dk'da stabil
- Kline + AI provider zinciri kanıtlandı
- Accounting/isolation temiz
- Threshold değiştirmeden gerçek baseline ölçümü için **tam süre** gerekli

### 🟡 12 saatlik PAPER — **opsiyonel**

8h sonrası daha fazla round + trade örneği için. İlk adım olarak 8h yeterli; 12h trade çıkma ihtimalini artırır ama garanti değil.

### ❌ Şu an yapma

- Threshold gevşetme (trade zorlamak için)
- LIVE açma
- Erken durdurma sonrası profitability kararı

---

## 13. Extended Paper Verdict

```text
INFRASTRUCTURE_READY_FOR_8H=true
FORMAL_4H_BASELINE_COMPLETE=false (early stop)
STRATEGY_TRADE_FREQUENCY=VERY_LOW (0 BUY in 82min)
RECOMMENDED_NEXT=paper-8h-full-runtime (same thresholds)
```

---

## 14. Artifacts

`artifacts/paper-campaigns/paper-4h-2026-09-07T19-59-48-598Z/`

- `account-snapshot-before.json`
- `frozen-config.json`, `preflight.json`
- `checkpoints.jsonl`, `final-snapshot.json`
- `selected-candidates.json`
- `kline-health.json`, `ai-consensus-summary.json`
- `rejection-histogram.json`, `dominant-gates.json`
- `accounting-reconciliation.json`, `runtime-health.json`
- `trade-forensic.json` (boş array)

**Machine result:** `kripto-4h-extended-paper-baseline-result.json`
