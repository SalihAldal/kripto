# Exchange Adapter Architecture

Bu katman, ust servislerin Binance TR API detaylarina dogrudan bagimli olmamasi icin eklendi.

## Yeni Katmanlar

- `src/types/exchange-adapter.ts`
  - Adapter interface
  - Normalize response modelleri
  - Normalize error modeli

- `src/server/exchange/adapters/binance-tr.adapter.ts`
  - Binance TR odakli adapter implementasyonu
  - Symbol rules normalize (tick/step/min notional/min qty/status)
  - Alis/satis emirleri normalize edilmis formatta
  - Open order listeleme
  - Fee / filter / precision normalize

- `src/server/exchange/adapters/error-mapper.ts`
  - Binance/HTTP/network hata kodlarini normalize eder

- `src/server/exchange/adapter-factory.ts`
  - Merkezi adapter secimi

## Entegrasyon

- `services/binance.service.ts` kritik pathlerde adapter kullaniyor:
  - balance
  - market/limit buy-sell
  - cancel/order status
  - filter & fee normalize

## Kazanimlar

- Ust katman artik borsa response format farklarini bilmek zorunda degil.
- Binance TR degisikligi tek noktada toplanir.
- Yeni borsa eklemek icin sadece yeni adapter + factory secimi yeterli olur.
- Emir akislari unit test seviyesinde daha kolay test edilir.
