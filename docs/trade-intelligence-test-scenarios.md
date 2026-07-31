## Trade Intelligence Test Senaryolari

Bu dokuman, yeni entegre edilen trade intelligence + trailing stop + dynamic target + live position analysis + risk manager
akisini manuel olarak dogrulamak icin test senaryolarini listeler. Frontend ve mevcut endpointler bozulmadan calismalidir.

### Ortam Hazirlik
- `EXECUTION_MODE=paper` veya `EXECUTION_MODE=live` secili olmali.
- `SCANNER_UNIVERSE=WATCHLIST` ve `EXECUTION_MANUAL_SCAN_SYMBOL_LIMIT=100` gibi ayarlar mevcut olabilir.
- Log dogrulamak icin `GET /api/trades/logs` endpointi kullanilabilir.

### Senaryo 1: Trailing stop yukari tasinmasi
**Amaç:** AI %4 hedef verdi, fiyat %3.5 cikti, stop %3 seviyesine tasindi.
- Baslat: Bir BUY pozisyonu ac, AI scorecard hedefi `%4`.
- Piyasa: Fiyat giris fiyati uzerine `%3.5` cikacak sekilde ilerlesin.
- Beklenen:
  - `TRAILING_STOP_ACTIVE` ve `ACTIVE_STOP_UPDATED` loglari olusur.
  - `activeStopPrice` giris fiyatinin `%3` uzerinde olacak sekilde yukari tasinir.

### Senaryo 2: Trailing stop geri donus satisi
**Amaç:** Fiyat %3 seviyesine geri dustu, sistem satis yapti.
- Senaryo 1 devaminda fiyat `%3` seviyesine geri dusurulur.
- Beklenen:
  - `STOP_TRIGGERED` event (reason: `TRAILING_PROFIT_LOCK` veya benzeri) olusur.
  - `SELL_COMPLETED` event kaydi.
  - Pozisyon `CLOSED` olur.

### Senaryo 3: Dynamic target guncelleme
**Amaç:** Fiyat %4 ustune cikti, AI tekrar analiz etti, hedef %6 olarak guncellendi.
- BUY pozisyonu ac, hedef `%4` olarak olussun.
- Fiyat `%4+` uzerine ciksin.
- AI tekrar analiz sonucunda `confidenceScore >= 80` ve `expectedMoveRange.max` daha yuksek olsun.
- Beklenen:
  - `AI_TARGET_RAISED` olusur.
  - `TARGET_SELL_CREATED` yeni hedefe gore guncellenir.
  - Eski hedefli emir guvenli sekilde iptal edilir (`OLD_ORDER_CANCELED`).

### Senaryo 4: Stop asagi dusmez
**Amaç:** Stop asagi dusmedi, sadece yukari tasindi.
- Fiyat yukari ciktikca `activeStopPrice` her adimda yukari tasinmali.
- Fiyat geriye cekildiginde `activeStopPrice` dusmemeli.
- Beklenen:
  - `ACTIVE_STOP_UPDATED` loglari yalnizca yukari yonlu olur.

### Senaryo 5: Eski satis iptal edilmeden yeni emir acilmasin
**Amaç:** Eski satis emri iptal edilmeden yeni emir acilmamali.
- Dynamic target senaryosunda once `OLD_ORDER_CANCELED` logu gorulmeli.
- Ardindan `NEW_SELL_ORDER_CREATED` eventi gelmeli.

### Senaryo 6: Ayni pozisyon icin cift satis olusmasin
**Amaç:** Ayni pozisyon icin cift satis emri olusmamali.
- Ayni anda trailing stop + target sell tetiklenmeye zorlanir.
- Beklenen:
  - `ensureSingleActiveExitOrder` tek bir aktif satis izni verir.
  - Cift `NEW_SELL_ORDER_CREATED` logu olmamali.

### Senaryo 7: Dusuk confidence trade acmasin
**Amaç:** AI dusuk confidence verirse trade acilmasin.
- AI sonucu `confidenceScore < 75` olacak sekilde kurgulanir.
- Beklenen:
  - Trade acilmaz, `RISK_GATE_BLOCKED` logu dusulur.

### Senaryo 8: Binance emir hatasi sistem dusurmesin
**Amaç:** Binance API hatasinda sistem stabil kalsin.
- Emir atma sirasinda `timeout` veya `http 429` benzeri hata simule edilir.
- Beklenen:
  - Sistem kapanmaz, retry mekanizmasi devreye girer.
  - Loglarda risk/engine uyarilari gorulur.

### Senaryo 9: Satis sonrasi pozisyon CLOSED
**Amaç:** Satis sonrasi pozisyon kapanis kaydi dogru olusur.
- Herhangi bir satis tamamlama akisi calistirilir.
- Beklenen:
  - Pozisyon `CLOSED` statusuna gecmis olmalidir.
  - `SELL_COMPLETED` ve `PNL_CALCULATED` loglari mevcuttur.

### Senaryo 10: Kar/Zarar dogru hesaplandi
**Amaç:** Kar/zarar hesaplari dogru olmalidir.
- Giris ve cikis fiyatlari bilinen bir ornekle test edilir.
- Beklenen:
  - `PNL_CALCULATED` logundaki degerler manuel hesapla uyusur.

