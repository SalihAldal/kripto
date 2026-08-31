# KRIPTO P3 — Live TDI Reachability Gate

Generated: 2026-08-28T22:35:51Z (finalized)
Session: `cmtdgqi7z0009unn0c4wc9qhr`
Rounds completed: **5** (min=3, max=5)

## Executive Summary

Telemetry-only paper validation. **No policy or threshold changes** during the run.

**Critical finding:** Across all 5 rounds, **zero candidates entered TDI** (`tdi-decisions.json` records = 0 every round). Therefore **decision-time `momentumScore` distribution cannot be measured** from TDI telemetry in this cohort. Zero-trade is **not** caused by TDI momentum threshold 60 — candidates never reached TDI.

## Final Verdict

| Field | Value |
|-------|-------|
| ROUNDS_COMPLETED | 5 |
| DECISION_SNAPSHOTS | 0 |
| SNAPSHOT_PERSISTENCE | PASS (no trades to bind) |
| MOMENTUM_MEDIAN | N/A |
| MOMENTUM_P90 | N/A |
| MOMENTUM_P95 | N/A |
| MOMENTUM_MAX | N/A |
| MOMENTUM_GE_60 | 0 |
| TDI_60_REACHABILITY | **UNKNOWN** (insufficient TDI samples) |
| TDI_ENTERED | 0 |
| TDI_SKIPPED | all lifecycle candidates (upstream) |
| TDI_APPROVED | 0 |
| EXECUTION_READY | 0 |
| TRADES | 0 |
| PRIMARY_BLOCKER | **AI_DEGRADED** (1107 funnel rejections) |
| ZERO_TRADE_CAUSE | **UPSTREAM_BLOCKER** |
| AI_HEALTH | PASS (configured) |
| RUNTIME_STATUS | STABLE |
| PAPER_COMPLETED | YES |
| POLICY_CHANGED | NO |

## Funnel Totals (rounds 1–5)

| Reason | Count |
|--------|-------|
| AI_DEGRADED | 1107 |
| NO_DIRECTIONAL_EDGE | 767 |
| MISSING_TELEMETRY | 403 |
| CONSENSUS_REJECT | 206 |
| SCANNER_AI_PRE_TDI_BLOCK | 15 |

## Answers to Gate Questions

1. **What momentumScore does runtime produce?** — Not observable at TDI; no TDI records persisted.
2. **Is TDI 60 reachable?** — **Cannot determine** from this run (D = insufficient data).
3. **Near-threshold candidates?** — None at TDI layer.
4. **High-confidence BUY below/above 60?** — 0 (no TDI path).
5. **Candidates reaching TDI?** — **No** (0/5 rounds).
6. **Upstream blocker?** — **Yes**: AI_DEGRADED dominates.
7. **decisionFeatureSnapshot persisted?** — Infrastructure ready; **0 trades** so no entry snapshots to verify.

## Policy Safety

THRESHOLD_CHANGED=NO | AI_VETO_CHANGED=NO | TDI_CHANGED=NO

## Next

**FIX_UPSTREAM_BLOCKER**: Resolve AI_DEGRADED / pre-TDI path before any TDI threshold experiment or second telemetry cohort.

---

## Ek Not — Disk Kullanımı (28–29 Ağu 2026)

### `C:\p` nedir? Benimle alakalı mı?

**Hayır — Cursor/agent ile alakalı değil.**

`C:\p` bir **junction (kısayol bağlantısı)**; hedefi:

`C:\Users\salih\Desktop\parallel`

İçerik: `parallel` monorepo projesi (`apps/`, `packages/`, `node_modules/`, Docker dosyaları, `parallel.txt` vb.). Oluşturulma: **16 Ağu 2026**.

| Bileşen | Tahmini boyut |
|---------|---------------|
| `apps/` | ~3.2 GB |
| `node_modules/` | ~1.6 GB |
| `packages/` | ~185 MB |
| **Toplam (gerçek veri)** | **~5 GB** |

`C:\p` silinirse sadece junction kalkar; asıl proje `Desktop\parallel` altında kalır. Tamamen kaldırmak için `Desktop\parallel` klasörünü silmek gerekir — bu ayrı bir proje, kripto/agent işi değil.

### Bugünkü agent işlemleri ne kadar yer kapladı?

| Kaynak | Boyut | Açıklama |
|--------|-------|----------|
| `kripto-main/artifacts/` (28–29 Ağu) | **~111 MB** | Paper run forensic export (5 round session + önceki denemeler) |
| `kripto-main/src/` + `tests/` | **~2.3 MB** | P3 decision-time TDI telemetry kodu + testler |
| `kripto-main/scripts/` | **~0.55 MB** | Gate/forensic scriptleri |
| `kripto-main/` root raporlar/CSV | **~1 MB** | P3 MD/JSON/CSV çıktıları |
| Cursor terminals log | **~3.2 MB** | Paper monitor terminal çıktıları |
| Cursor agent-transcripts | **~5.6 MB** | Sohbet transcript kayıtları |
| **Bugün toplam (tahmini)** | **~124 MB** | Repo + Cursor overhead |

Ana P3 live session forensic (`cmtdgqi7z…`): **~4 MB** (5 round JSON export).

### Disk doluluğu notu

C diski doluluğu bugünkü ~124 MB agent işinden değil; birikmiş `artifacts/forensics` (**~603 MB** toplam) ve özellikle `C:\p` → `parallel` projesi (**~5 GB**) kaynaklı. Agent oturumu sırasında `scripts/run-p3-live-tdi-reachability-gate.ts` disk doluluğu yüzünden boşalmış — restore için alan açılması gerekiyor.

### Temizlik önerisi (agent işleri için)

- `artifacts/forensics/` altındaki eski session klasörleri (bugünkü `cmtdgqi7z…` hariç)
- `.cursor/projects/.../terminals/*.txt` eski loglar
- `C:\p` **silme** — parallel projesi; agent ile ilgisi yok
