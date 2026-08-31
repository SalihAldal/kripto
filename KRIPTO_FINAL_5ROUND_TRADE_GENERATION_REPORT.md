# KRIPTO — FINAL 5-ROUND TRADE GENERATION GATE

Generated: 2026-08-28T19:35:00+03:00  
Session: `cmtd396jg0009un7c8im4dggo`  
Mode: **PAPER** | Exchange: **BINANCE_TR** | AI: **REAL_AI** (3 provider)  
Operator: **Tur 5 atlandı** — 4 ardışık policy block yeterli kanıt

---

## Executive Summary

Bu gate'in amacı kârlılık kanıtlamak değildi. Soru şuydu:

> Post-fix pipeline doğal olarak executable trade üretebiliyor mu?

**Cevap: Hayır — 4 turda 0 trade.** Ancak bu bir **runtime/safety failure değil**; pipeline stabil çalıştı ve funnel tutarlı şekilde **scanner AI gate**'de durdu.

| Alan | Sonuç |
|------|-------|
| Analiz edilen tur | **4/5** (tur 5 operatör iptali) |
| Runtime | **STABLE** |
| Teknik güven | **HIGH** |
| Trade generation signal | **NEGATIVE** |
| Ana blocker | **SCANNER_AI** |
| 30-round kararı | **CONDITIONAL (YELLOW)** |

**Öneri:** 30-round kampanya **runtime izleme ile başlatılabilir** — ancak mevcut piyasa rejiminde trade beklenmemeli; amaç funnel coherence ve safety doğrulaması olmalı, PnL değil.

---

## Preflight — PASS

Kampanya başlamadan önce tüm kritik kontroller geçti:

| Kontrol | Durum |
|---------|-------|
| DB | PASS |
| Binance TR | PASS (BTCTRY ticker ok) |
| AI providers | PASS (3 enabled: 2× OpenAI gpt-4o-mini, 1× Gemini) |
| Emergency stop | PASS (inactive) |
| Active jobs | PASS |
| Zombie rounds | PASS |
| Clock sync | PASS |

`usePaperProfile`: aktif | Threshold değişikliği: **yok** | Force trade: **yok**

---

## Tur Bazlı Sonuçlar

| Tur | Sembol | Süre | Confidence | AI karar | Fail reason | İlk blocker |
|-----|--------|------|------------|----------|-------------|-------------|
| 1 | EDENTRY | 20.6 dk | **78** | BUY vs NO-TRADE conflict | `AI_GATE_BLOCK: AI_DECISION_CONFLICT` | SCANNER_AI |
| 2 | GENIUSTRY | 16.7 dk | **22.97** | NO_TRADE | `NON_EXECUTABLE_DECISION: NO_TRADE` | SCANNER_AI |
| 3 | HOLOTRY | 17.1 dk | **24.22** | NO_TRADE | `NON_EXECUTABLE_DECISION: NO_TRADE` | SCANNER_AI |
| 4 | FDUSDTRY | 19.4 dk | **17.9** | NO_TRADE | `NON_EXECUTABLE_DECISION: NO_TRADE` | SCANNER_AI |
| 5 | — | — | — | — | `OPERATOR_ABORT` (atlandı) | — |

**Toplam süre (4 tur):** ~74 dakika

---

## Funnel Waterfall (4 tur aggregate)

Her turda runtime progress breakdown aynı profile işaret etti:

```
selection=100% → pump=100% → scanner=100% → aiAnalysis=100% → execution=0%
```

| Aşama | Tur 1 | Tur 2 | Tur 3 | Tur 4 | Toplam |
|-------|-------|-------|-------|-------|--------|
| Pump scan (live aday) | ~62 | ~62 | ~62 | ~62 | ~248 |
| Paper lane admission | 1 | 1 | 1 | 1 | **4** |
| Scanner AI reached | YES (~88 batch) | YES | YES | YES | **4** |
| Execution AI reached | NO | NO | NO | NO | **0** |
| TDI entered | 0 | 0 | 0 | 0 | **0** |
| TDI skipped | 1 | 1 | 1 | 1 | **4** |
| Consensus | 0 | 0 | 0 | 0 | **0** |
| EV | 0 | 0 | 0 | 0 | **0** |
| Risk / Sizing | 0 | 0 | 0 | 0 | **0** |
| Execution-ready | 0 | 0 | 0 | 0 | **0** |
| Trade opened | 0 | 0 | 0 | 0 | **0** |

**Semantik ayrım doğrulandı:**
- `scanner_ai_reached` = 4, `execution_ai_reached` = 0 (karıştırılmadı)
- `tdi_skipped` = 4, `tdi_rejected` = 0 (ayrı sayıldı)

---

## Tur Detay Analizi

### Tur 1 — EDENTRY (AI Reliability Block)

- **Süre:** 20.6 dk — en uzun tur (88 adaylık scanner AI batch)
- **Metadata:** `aiFinalDecision=BUY`, `aiConsensusDecision=NO-TRADE`, `confidence=78`
- **Sınıflandırma:** `AI_RELIABILITY` — provider consensus uyuşmazlığı
- **Waterfall:** 62 pump → paper admit → 88 scanner AI → **CONFLICT** → TDI skip → trade=0
- **Yorum:** Yüksek confidence BUY önerisi var ama consensus NO-TRADE döndü. Bu infrastructure failure değil; AI gate doğru çalıştı ve execution'a geçmedi.

### Tur 2 — GENIUSTRY (Policy Block)

- **Confidence:** 22.97 (< 45 min threshold)
- **Sınıflandırma:** `AI_POLICY` — düşük confidence NO_TRADE
- **Waterfall:** scanner AI → NO_TRADE → TDI'ya hiç girilmedi

### Tur 3 — HOLOTRY (Policy Block)

- **Confidence:** 24.22
- **Aynı profil:** scanner AI policy rejection

### Tur 4 — FDUSDTRY (Policy Block)

- **Confidence:** 17.9 — en düşük
- **Stablecoin pair:** FDUSDTRY — AI düşük confidence ile reddetti
- **Aynı profil:** downstream'a hiç ulaşılmadı

### Tur 5 — OPERATOR_SKIP

- Operatör kararıyla atlandı (4/4 aynı blocker pattern)
- Job `STOPPED`, failReason: `OPERATOR_ABORT_AFTER_4_ROUNDS`

---

## AI Sağlık Özeti

| Sınıf | Tur | Açıklama |
|-------|-----|----------|
| AI_RELIABILITY | 1 | EDENTRY — BUY/NO-TRADE conflict |
| AI_POLICY | 2, 3, 4 | Düşük confidence NO_TRADE |
| INSUFFICIENT_CONTEXT | 0 | — |
| Infrastructure failure | 0 | Provider timeout/degraded dominant değil |

**AI path dağılımı:**
- Tur 1: `RELIABILITY_FAILURE`
- Tur 2–4: `POLICY_REJECTION`

Policy NO_TRADE'ler infrastructure failure olarak sayılmadı ✓

---

## Runtime Safety

| Kontrol | Değer | Limit | Durum |
|---------|-------|-------|-------|
| AI_STARTED orphans | 0 | 0 | ✓ |
| Zombies | 0 | 0 | ✓ |
| Duplicate orders | 0 | 0 | ✓ |
| PnL mismatch | 0 | 0 | ✓ |
| AI VETO bypass | 0 | 0 | ✓ |
| Risk bypass | 0 | 0 | ✓ |
| Sizing bypass | 0 | 0 | ✓ |
| Heartbeat stall | 0 | — | ✓ |
| P2002 / 25P02 cascade | 0 | — | ✓ |

**RUNTIME_STATUS = STABLE**

---

## Profitability Snapshot

| Metrik | Değer |
|--------|-------|
| Trades | 0 |
| Net PnL | 0 |
| Expectancy | N/A |
| Profit factor | N/A |
| Max drawdown | 0 |

5 tur trade üretemez — bu sadece **trade generation signal** ölçümü.

---

## 30 Soru — Cevaplar

1. **5 tur bitti mi?** PARTIAL — 4 terminal, tur 5 operatör iptali
2. **Kaç aday?** ~62 pump scan / tur, ~88 scanner AI batch (tur 1 log kanıtı)
3. **Paper lane?** 4/4 tur admitted
4. **Scanner AI?** 4/4
5. **Execution AI?** 0/4
6. **TDI entered?** 0/4
7. **TDI approved?** 0
8. **Consensus?** 0/4
9. **EV passed?** 0
10. **Risk passed?** 0
11. **Sizing passed?** 0
12. **Execution-ready?** 0
13. **Trades opened?** 0
14. **Closed?** 0
15. **Net PnL?** 0
16. **Main blocker?** SCANNER_AI
17. **Second blocker?** NONE (hepsi aynı gate)
18. **Top movers seen?** Evet — pump live scan ~62 aday/tur
19. **Kaç blocker?** 4/4 paper admitted adaylar scanner AI'da durdu
20. **Hangi aşama?** SCANNER_AI (pre-TDI)
21. **False-negative kanıtı?** Hayır — policy/reliability rejection tutarlı
22. **AI reliability blocker?** Evet — tur 1 conflict (PARTIAL)
23. **Scanner blocker?** Scanner üretiyor, AI gate blokluyor
24. **TDI reached?** Hayır
25. **EV reached?** Hayır
26. **Execution reached?** Hayır
27. **Trade lifecycle proven?** Hayır
28. **Variant_D executed?** Hayır
29. **Teknik güvenilirlik?** HIGH
30. **30-round?** CONDITIONAL

---

## Final Verdict

```
FIVE_ROUNDS_COMPLETED = PARTIAL (4 analyzed, 1 skipped)
ROUNDS_TERMINAL = YES (4/4 analyzed)
TOTAL_CANDIDATES = ~248 pump-scanned (62×4)
PAPER_LANE_ADMITTED = 4
SCANNER_AI_REACHED = 4
EXECUTION_AI_REACHED = 0
TDI_ENTERED = 0
TDI_APPROVED = 0
CONSENSUS_REACHED = 0
EV_REACHED = 0
EV_APPROVED = 0
RISK_APPROVED = 0
SIZING_APPROVED = 0
EXECUTION_READY = 0
OPENED_TRADES = 0
CLOSED_TRADES = 0
NET_PNL = 0
EXPECTANCY = N/A
PROFIT_FACTOR = N/A
MAX_DRAWDOWN = 0
PRIMARY_BLOCKER = SCANNER_AI
SECONDARY_BLOCKER = NONE
AI_RELIABILITY = PARTIAL (1 conflict / 4 rounds)
SCANNER_HEALTH = PASS (aday üretiyor)
TDI_HEALTH = PASS (skip semantics doğru, reject karışmadı)
EV_HEALTH = PARTIAL (hiç ulaşılmadı)
EXECUTION_HEALTH = PARTIAL (hiç ulaşılmadı)
AI_STARTED_ORPHANS = 0
ZOMBIES = 0
DUPLICATE_ORDERS = 0
PNL_MISMATCHES = 0
VARIANT_D_LIVE_TRADES = 0
TRADE_GENERATION_SIGNAL = NEGATIVE
RUNTIME_STATUS = STABLE
TECHNICAL_TRUST = HIGH
READY_FOR_30_ROUNDS = CONDITIONAL
```

**NEXT_STEP:** 30-round paper kampanyası **runtime/safety izleme modunda** başlatılabilir. Trade beklentisi düşük tutulmalı — dominant profil scanner AI policy rejection. Kampanya sırasında threshold/AI/risk değişikliği yapılmamalı.

---

## Artifact Dosyaları

| Dosya | İçerik |
|-------|--------|
| `kripto-final-5round-trade-generation.json` | Tam payload + preflight + round analizi |
| `kripto-final-5round-readiness.json` | 30-round readiness kararı |
| `kripto-final-5round-rounds.csv` | Tur telemetrisi |
| `kripto-final-5round-funnel.csv` | Stage waterfall |
| `kripto-final-5round-ai.csv` | AI sağlık |
| `kripto-final-5round-opportunities.csv` | Opportunity correlation |
| `kripto-final-5round-trades.csv` | Boş (0 trade) |
| `kripto-final-5round-pnl.csv` | Boş (0 trade) |
| `kripto-final-5round-runtime.csv` | Runtime safety |
| `artifacts/forensics/cmtd396jg0009un7c8im4dggo/rounds/{1-4}/` | 72 artifact/tur |

---

*Measurement gate only. Zero trades = valid data. No policy tuning during run.*
