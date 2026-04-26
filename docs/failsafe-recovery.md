# Failsafe ve Recovery Altyapisi

Bu dokuman, restart/network timeout/worker dusmesi senaryolarinda state kaybi ve duplicate order riskini azaltmak icin eklenen yapiyi ozetler.

## 1) State Persistence

`AppSetting` tablosu uzerinden kullanici bazli snapshotlar:

- `failsafe.analysis_state.{userId}`
  - aktif analiz (executionId, symbol, stage, status)
- `failsafe.round_state.{userId}`
  - aktif tur (jobId, roundNo, state, symbol, status)
- `failsafe.last_event.{userId}`
  - son kritik event (stage, status, message)
- `failsafe.reconcile_state.{userId}`
  - restart sonrası local/remote uzlastirma sonucu
- `failsafe.safe_mode.{userId}`
  - safe-mode durumu
- `failsafe.idempotency.{userId}.{key}`
  - idempotent order/execution kaydi

## 2) Recovery Senaryolari

Servis: `src/server/recovery/failsafe-recovery.service.ts`

`runRestartRecovery()`:
- acik pozisyonlari DB'den okur
- pending emirleri bulur (`NEW`, `PARTIALLY_FILLED`)
- borsadan order status tekrar ceker
- local status ile uzlastirir (gerekirse DB update)
- belirsiz emirler kalirsa conflict isaretler
- conflict varsa safe-mode aktif eder

## 3) Guvenlik Kurallari

- Safe-mode aktifse yeni trade acilmaz.
- Acik pozisyon varken yeni trade engeli mevcut kural ile devam eder.
- Pending order belirsizse recovery dogrulamasi zorunlu olur.
- Conflict durumunda `requireManualAck=true` ile manuel panel onayi gerekir.
- Idempotency key ile ayni istekte duplicate acilis engellenir.

## 4) Safe Mode

Endpointler:
- `GET /api/failsafe/safe-mode`
- `POST /api/failsafe/safe-mode`

Davranis:
- yeni order acma akisi bloklanir
- sadece reconcile/verify aksiyonu calistirilir
- panelde safe-mode gorulur ve manuel ac/kapa yapilabilir

## 5) Timeout / Retry

- Recovery order status fetch timeout: 3.5s (controlled timeout)
- Sonsuz retry yok; bounded deneme ve unresolved state kaydi var
- Idempotency ile duplicate order acilisi engellenir

## 6) Restart Sonrasi Toparlanma Ornek Akis

1. Uygulama acilir -> `validateStartupConfig()` tetiklenir
2. `runRestartRecovery()` acik pozisyon + pending order ceker
3. Remote order status kontrol edilir
4. Local state uzlastirilir, unresolved listesi olusturulur
5. Conflict varsa safe-mode aktif edilir
6. Admin panelden manuel onay / recovery rerun ile normal moda donulur
