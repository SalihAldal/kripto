# Production Security Hardening

Bu dokuman, Binance TR odakli al-sat sisteminde production seviyesinde guvenlik iyilestirmelerini ozetler.

## Uygulanan Guvenlik Katmanlari

- API token rotation destegi (`APP_TOKEN` + `APP_TOKEN_NEXT`)
- Constant-time token karsilastirma (timing attack riskini azaltir)
- CSRF korumasi (`SECURITY_REQUIRE_CSRF=true`)
- Role-based access control (ADMIN / TRADER / VIEWER)
- Kritik endpointlerde manuel onay (`x-confirm-action=CONFIRM`)
- Request payload sanitization (`sanitizePayload`)
- Idempotency key destekli kritik endpoint korumasi
- Kullanici bazli action lock ile cakisan manuel islem engeli
- API secretlarinin AES-256-GCM ile sifrelenmesi
- Secret masking ve logger redaction kapsam genisletmesi

## Kritik Headerlar

- `x-kinetic-token` veya `Authorization: Bearer <token>`
- `x-confirm-action: CONFIRM` (kritik endpointler)
- `idempotency-key` (manual open / round start gibi kritik operasyonlar)
- `x-user-id` (opsiyonel runtime user secimi)

## Secret Storage Yaklasimi

- Binance API secret degeri plain-text olarak DB'ye yazilmaz.
- `src/server/security/secrets.ts` ile AES-256-GCM sifreleme uygulanir.
- Sifreli deger `AppSetting` tablosunda `isSecret=true` olarak saklanir.
- `exchangeConnection.apiSecretEncrypted` alani sadece sifreli degeri tutar.

## Role Politikasi (Onerilen)

- `ADMIN`: ayarlar, risk config, strategy rollback, emergency stop, auth diagnostics
- `TRADER`: manuel open/close/cancel, round start/stop
- `VIEWER`: read-only admin panelleri

## Guvenlik Testleri (Ornek Senaryolar)

1. `x-confirm-action` olmadan `POST /api/trades/open` => `428`
2. Gecersiz token ile kritik endpoint => `401`
3. `idempotency-key` ayni iken tekrar `POST /api/trades/open` => onceki cevap doner
4. Ayni anda iki manuel open istegi => ikinci istek `409`
5. TRADER rolu ile ADMIN endpointine erisim => `403`

