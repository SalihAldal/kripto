# KRIPTO — 8H PAPER Corrected Retrospective Report

Campaign: `paper-8h-2026-09-07T0012Z` · Job: `cmtqhz77p000fun84lgcyuckv`

## Özet

- Seçilmiş aday (symbol not null): **8**
- Tamamlanmış seçimsiz round: **38**
- Yarım round: **1**
- DB işlem: **0** (positions/orders/paperTrades campaign window)

## Seçilen 8 aday — kanıtlanabilen terminal aşama

| Tur | Symbol | Terminal (metadata) |
|-----|--------|---------------------|
| 2 | ARBTRY | INTERNAL_ERROR:UNKNOWN:UNCLASSIFIED_TERMINAL_REASON No tradeable candidate after scanner+AI |
| 3 | XPLTRY | INTERNAL_ERROR:UNKNOWN:UNCLASSIFIED_TERMINAL_REASON No tradeable candidate after scanner+AI |
| 4 | ARBTRY | INTERNAL_ERROR:UNKNOWN:UNCLASSIFIED_TERMINAL_REASON No tradeable candidate after scanner+AI |
| 5 | AVAXTRY | INTERNAL_ERROR:UNKNOWN:UNCLASSIFIED_TERMINAL_REASON No tradeable candidate after scanner+AI |
| 6 | SUIUSDT | INTERNAL_ERROR:UNKNOWN:UNCLASSIFIED_TERMINAL_REASON No tradeable candidate after scanner+AI |
| 7 | ADAUSDT | INTERNAL_ERROR:UNKNOWN:UNCLASSIFIED_TERMINAL_REASON No tradeable candidate after scanner+AI |
| 8 | VETUSDT | INTERNAL_ERROR:UNKNOWN:UNCLASSIFIED_TERMINAL_REASON No tradeable candidate after scanner+AI |
| 9 | PUMPTRY | INTERNAL_ERROR:UNKNOWN:UNCLASSIFIED_TERMINAL_REASON No tradeable candidate after scanner+AI |

## Seçimsiz roundlar

Toplam 38 tur. Dominant: `INTERNAL_ERROR:NO_ELIGIBLE_CANDIDATE` (~600s seçim deadline + ~90s observe).

## Yarım round

- Tur 47: state=`tariyor`, runtime.step=`FULL_SCAN`

## Kanıt sınırları

- Orijinal rapor `failReason` null olduğu için 'Bilinmeyen' gösterdi; gerçek neden `metadata.terminalReason` içinde.
- 8 seçilen adayın tamamı execution öncesi `No tradeable candidate after scanner+AI` / handoff AI eksikliği ile sonlandı (CONFIRMED forensic bundle).
- Round 10–46 için canonical store telemetry tarihsel olarak kısmen eksik; kök neden UNKNOWN (pipeline durdu mu vs piyasa yok mu ayrıştırılamadı).