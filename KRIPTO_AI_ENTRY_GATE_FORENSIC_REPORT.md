# KRIPTO — AI Consensus / Entry Quality Forensic Report

> **Phase:** AI CONSENSUS / ENTRY QUALITY FORENSIC & ADMISSION CONTRACT VALIDATION  
> **Starting HEAD:** `ec1bc2b51f7f8bb0b7758dc556befbd1dc715513`  
> **Reference campaign:** `paper-1h-2026-09-07T15-47-43-241Z` / job `cmtrezwvc000bunbk5fgm1kvl`  
> **Generated:** 2026-09-07

---

## 1. Executive Summary

| Alan | Sonuç |
|------|-------|
| **Verdict** | **PARTIAL** — contract kanıtlandı + bug'lar düzeltildi; 1h campaign'de gerçek provider consensus çalışmadı |
| **AI_CONSENSUS_VERDICT** | **DEGRADED_DATA_PATH** (kline stale early exit) |
| **AI_RISK_VERDICT** | **VERIFIED_SAFETY_DEFAULT** (risk=100 hardcoded, provider değil) |
| **CONFIDENCE_SCALE_VERDICT** | **VERIFIED_0_100** |
| **ENTRY_QUALITY_VERDICT** | **VERIFIED_AND_FIXED** |
| **TERMINAL_TAXONOMY_VERDICT** | **FIXED** |
| **BUG_FOUND** | **true** |
| **BUG_FIXED** | **true** |
| **READY_FOR_EXTENDED_PAPER** | **false** (kline stale → AI provider path hiç çalışmadı) |

**Ana sonuç:** 1h campaign'deki `NO_TRADE + risk=100 + confidence 73–77%` kombinasyonu **gerçek 3-provider consensus değil**. AI `Kline data missing or stale` ile erken çıkış yaptı (`outputs=[]`, `finalRiskScore=100` safety default). `%73–77` **scanner confidence fallback** idi; entry-quality gate bunu AI risk ile karıştırdı. **Advisory shell kullanılmadı** (shell risk=0 olurdu).

---

## 2. Soru 1 — NO_TRADE neden entry-quality'ye gidiyor?

**Cevap: B) AI NO_TRADE advisory — execution değerlendirmesi devam eder.**

Kanıt:

```103:108:src/server/execution/ai-execution-gate.service.ts
export function resolveAiExecutionGatePolicy(_input?: { mode: TradingMode; learningLane: boolean }): AiExecutionGatePolicy {
  void _input;
  void env.EXECUTION_AI_GATE_POLICY;
  // Canonical runtime: AI is advisory-only in all modes.
  return "ADVISORY";
}
```

```2027:2036:src/server/execution/auto-round-engine.service.ts
        if (isBlockingAiDecision(aiFinalDecision)) {
          recordCandidateFunnelStage({
            ...
            reasonCode: "AI_ADVISORY",
            reasonDetail: `AI decision=${aiFinalDecision || "EMPTY"} is advisory; canonical path continues`,
```

**Ek bulgu (bug):** Orchestrator'da `no-trade-gate` entry-quality'den **sonra** çalışıyordu → NO_TRADE adaylar entry-quality mesajıyla terminal oluyordu (yanlış observability).

**Fix:** `no-trade-gate` entry-quality'den **önce** taşındı (`execution-orchestrator.service.ts`).

---

## 3. Soru 2 — aiRisk=100 kaynağı

**Producer:** `analysis-orchestrator.ts` — kline stale/missing **early exit** (provider çağrılmadan önce).

```891:912:src/server/ai/analysis-orchestrator.ts
  if (input.klines.length < 20 || (klineAgeSec !== null && klineAgeSec > 180)) {
    const reason = "Kline data missing or stale";
    ...
    return {
      finalDecision: "NO_TRADE",
      finalConfidence: 0,
      finalRiskScore: 100,
      ...
      outputs: [],
      rejected: true,
```

**DB kanıtı (5/5 symbol):** `tradeEventLog` → `AI_ANALYSIS_RESULT: Kline data missing or stale`

| Kaynak | 1h campaign? |
|--------|--------------|
| AI provider gerçek response | ❌ (outputs boş) |
| Consensus aggregation | ❌ |
| NO_TRADE mapping | ❌ |
| Kline stale safety default | ✅ |
| Advisory shell | ❌ (risk=0 olurdu) |
| Missing field default | ❌ |

---

## 4. AI Risk Trace (5 aday)

| Symbol | rawProvider* | consensusDecision | consensusRisk | handoffDecision | executionDecision | entryQuality (historical) |
|--------|-------------|-------------------|---------------|-----------------|-------------------|---------------------------|
| EPICUSDT | N/A (no outputs) | N/A | 100 (stale exit) | NO_TRADE | NO_TRADE | reject @ 73% scanner |
| ARBTRY | N/A | N/A | 100 | NO_TRADE | NO_TRADE | reject @ 77% scanner |
| ONDOUSDT | N/A | N/A | 100 | NO_TRADE | NO_TRADE | reject @ 73% scanner |
| CFGTRY | N/A | N/A | 100 | NO_TRADE | NO_TRADE | reject @ 74% scanner |
| OPENUSDT | N/A | N/A | 100 | NO_TRADE | NO_TRADE | reject @ 74% scanner |

\*Provider vote persist edilmedi — early exit provider loop'una girmedi.

**Corrected first reject gate:** `AI_NO_TRADE` (post-fix gate order)

Artifact: `artifacts/paper-campaigns/.../ai-consensus-trace.json`, `1h-candidate-reclassification.json`

---

## 5. Soru 3 — Confidence contract

| Observed %73–77 | Gerçek kaynak |
|-----------------|---------------|
| AI provider | 0 (stale exit) |
| AI consensus | N/A |
| **Scanner fallback** | **✅ `resolveExecutionConfidenceScore`** |
| Entry-quality (fix öncesi) | Scanner fallback (yanlış) |
| Entry-quality (fix sonrası) | AI/scorecard only (`resolveEntryQualityConfidenceScore`) |

```238:265:src/server/execution/canonical-handoff.service.ts
export function resolveExecutionConfidenceScore(...) {
  // ... scorecard → scanner fallback for canonical handoff display
}
export function resolveEntryQualityConfidenceScore(...) {
  // AI/scorecard only — never scanner fallback
}
```

---

## 6. Score Scale Audit

| Field | Producer | Consumer | Type | Range | 1h actual |
|-------|----------|----------|------|-------|-----------|
| scannerConfidence | scanner | resolveExecutionConfidenceScore fallback | 0–100 | 0–100 | 73–77 |
| aiConfidence | hybrid/consensus | orchestrator gates | 0–100 | 0–100 | 0 |
| aiRisk / finalRiskScore | orchestrator early exit / hybrid | entry-quality | 0–100 | 0–100 | 100 |
| executionConfidence | resolveExecutionConfidenceScore | confidence gate, telemetry | 0–100 | 0–100 | 73–77 (fallback) |
| entryQualityConfidence | resolveEntryQualityConfidenceScore | shouldRejectHighRiskLowConfidenceEntry | 0–100 | 0–100 | 0 (post-fix) |

**0–1 vs 0–100:** API contract 0–100. `0.85` otomatik `%85`'e normalize **edilmez** (test CASE 5). Scale mismatch bug: scanner fallback entry-quality'de kullanılıyordu → **fixed**.

---

## 7. %82 Elite Confidence Floor

| Soru | Cevap |
|------|-------|
| Dosya | `src/server/execution/profit-thresholds.ts` |
| Config | `TRADE_QUALITY_POLICY.minConfidenceForHighRiskEntry = 82` |
| Hardcoded | Policy constant (regime ile adjust) |
| Koşul | `aiRiskScore > 75` **ve** `confidence < elite floor` |
| Tüm adaylara | Hayır — sadece elevated risk |
| NO_TRADE'da | Advisory path devam eder; post-fix NO_TRADE önce reject |

```9:16:src/server/execution/profit-thresholds.ts
export const TRADE_QUALITY_POLICY = {
  maxAiRiskScoreWithoutEliteConfidence: 75,
  minConfidenceForHighRiskEntry: 82,
  ...
};
```

Regime adjust: `resolveRegimeAwareEntryQualityThreshold` (`regime-intelligence.service.ts`).

**Threshold değiştirilmedi.**

---

## 8. NO_TRADE Semantics

| Semantik | Kod |
|----------|-----|
| Kesin execution veto | ❌ (policy=ADVISORY) |
| **Advisory** | **✅** |
| Provider majority | Kısmen (consensus engine ayrı) |
| Absence of BUY | Evet (consensus-engine) |

`resolveNoTradeReasons` non-BUY/SELL için `"AI karari trade acmaya uygun degil (NO_TRADE)"` ekler.

---

## 9. Advisory Shell Kontrolü

| Symbol | Shell? | Kanıt |
|--------|--------|-------|
| 5/5 | **Hayır** | `finalRiskScore=100` (shell=0), `rejectReason=Kline data missing or stale`, `outputs=[]` |

Shell tanımı:

```142:154:src/server/execution/canonical-handoff.service.ts
export function buildCanonicalAdvisoryAiShell(...) {
  return {
    finalDecision: "NO_TRADE",
    finalConfidence: 0,
    finalRiskScore: 0,
```

---

## 10. Provider Consensus Forensic

**5/5 adayda provider vote yok** — kline stale early return provider loop'undan önce.

3 provider aktif (preflight) ancak execution-time consensus çalışmadı. **BUY/BUY/NO_TRADE aggregation senaryosu bu campaign'de test edilemedi.**

---

## 11. AI Risk = 100 Audit (kod + test)

| Case | Beklenen | Test |
|------|----------|------|
| A: BUY conf=80 risk=20 | risk≈20 | `ai-entry-quality-admission-contract.test.ts` |
| B: NO_TRADE conf=75 risk=70 | consensus avg, not auto-100 | consensus-engine.ts avgRisk |
| C: risk missing | consensus avgRisk default 100 if no healthy | consensus-engine:102 |
| D: parse error | provider degraded path | analysis-orchestrator |
| E: 3 provider farklı risk | **average** (consensus-engine) | summarizeConsensus |

Kline stale: **explicit 100** hardcode (safety).

---

## 12. Entry Quality Contract Tests

Yeni suite: `tests/ai-entry-quality-admission-contract.test.ts` (17 test)

- CASE 1–6 deterministic caseler
- Admission decision matrix (6 row)
- Advisory shell vs stale exit
- Terminal taxonomy

---

## 13. Admission Decision Matrix (entry-quality gate)

| AI decision | Confidence | Risk | Entry result |
|-------------|-----------:|-----:|--------------|
| BUY | 90 | 20 | PASS |
| BUY | 75 | 20 | PASS |
| BUY | 90 | 100 | PASS (elite floor) |
| BUY | 75 | 100 | **REJECT** |
| NO_TRADE | 90 | 20 | PASS (gate only; NO_TRADE gate rejects first post-fix) |
| NO_TRADE | 75 | 100 | REJECT if reached (post-fix: NO_TRADE gate first) |

---

## 14. Bugs Found & Fixes

| Bug | Fix | Test |
|-----|-----|------|
| NO_TRADE after entry-quality (wrong gate order) | Reorder no-trade before entry-quality | integration CASE 2 |
| Scanner conf mixed into entry-quality | `resolveEntryQualityConfidenceScore` | admission contract test |
| UNCLASSIFIED terminal for entry quality | `ENTRY_QUALITY:AI_RISK_ELEVATED_LOW_CONFIDENCE` + taxonomy | round-terminal-outcome |
| Misleading "73% < 82%" when AI conf=0 | Entry-quality uses AI-only confidence | score-scale + admission tests |

**Threshold değiştirilmedi.**

---

## 15. 1h Campaign Reclassification

| Symbol | True AI Source | Decision | Conf | Risk | Correct Terminal |
|--------|----------------|----------|-----:|-----:|------------------|
| EPICUSDT | KLINE_STALE_EARLY_EXIT | NO_TRADE | 0 | 100 | ai_rejected |
| ARBTRY | KLINE_STALE_EARLY_EXIT | NO_TRADE | 0 | 100 | ai_rejected |
| ONDOUSDT | KLINE_STALE_EARLY_EXIT | NO_TRADE | 0 | 100 | ai_rejected |
| CFGTRY | KLINE_STALE_EARLY_EXIT | NO_TRADE | 0 | 100 | ai_rejected |
| OPENUSDT | KLINE_STALE_EARLY_EXIT | NO_TRADE | 0 | 100 | ai_rejected |

DB mutate edilmedi. Artifact: `1h-candidate-reclassification.json`

---

## 16. Tests

| Suite | Sonuç |
|-------|-------|
| typecheck | PASS |
| ai-entry-quality-admission-contract | 17/17 PASS |
| score-scale-entry-quality | 2/2 PASS |
| trade-quality-policy | 5/5 PASS |
| round-terminal-outcome | 4/4 PASS |
| canonical-handoff | 5/5 PASS |
| canonical-paper-full-chain | 6/6 PASS |

Controlled 20–30m smoke: **atlandı** — fix'ler observability/gate-order; trade outcome değişmedi, threshold değişmedi. Kline stale ayrı runtime sorunu.

---

## 17. Final Verdict

```text
AI_CONSENSUS_VERDICT=DEGRADED_DATA_PATH
AI_RISK_VERDICT=VERIFIED_SAFETY_DEFAULT
CONFIDENCE_SCALE_VERDICT=VERIFIED_0_100
ENTRY_QUALITY_VERDICT=VERIFIED_AND_FIXED
TERMINAL_TAXONOMY_VERDICT=FIXED
BUG_FOUND=true
BUG_FIXED=true
READY_FOR_EXTENDED_PAPER=false
```

**Extended paper öncesi:** Kline data pipeline'ının AI consensus'a ulaşmasını doğrula (klines.length ≥ 20, age ≤ 180s). Threshold calibration bu phase'in kapsamı dışında.

---

## 18. Threshold Calibration Recommendation

- `%82` elite floor: elevated risk (>75) için intended — değiştirme
- Risk=100 kline stale default: trade admission'da AI risk olarak kullanımı gözden geçirilebilir (ayrı phase)
- Scanner fallback: execution telemetry için OK, admission için kullanılmamalı (fixed)

---

## Artifacts

- `kripto-ai-entry-gate-forensic-result.json`
- `artifacts/paper-campaigns/paper-1h-2026-09-07T15-47-43-241Z/ai-consensus-trace.json`
- `artifacts/paper-campaigns/paper-1h-2026-09-07T15-47-43-241Z/1h-candidate-reclassification.json`
