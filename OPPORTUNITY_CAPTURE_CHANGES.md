# Fırsat yakalama düzeltmeleri ve karar

Bu değişiklik günlük %1–4 sağlayan bir strateji teslimi değildir. Mevcut OI ailesi ve bu tur sınanan iki hızlı giriş adayı için maliyet sonrası yeterli ekonomik kanıt yoktur. Gerçek para modu açılmadı. Başarısız adaylar otomatik üretim seçimine alınmadı.

Başlangıç: kullanıcının GitHub'a yüklediği `2a44028`, `codex/window-validation-and-risk-fixes`.

## Üretim kodunda giderilen kapsam sorunları

- Pump listesi sıcak liderlerle dolunca normal watchlist sırasının tamamen kesilmesi giderildi. Tarama bütçesinin en fazla üçte biri, yapılandırılan keşif parti boyutuyla sınırlı olarak dönen keşif sırasına ayrılır; kalan kapasite liderlere gider. Varsayılan 36 adaylık bütçede en fazla 12 keşif adayıdır.
- Süre sınırı geldiğinde hiç başlatılmayan keşif işlerinin sırası ilerletilmez. `scanned` gerçekten başlatılan iş sayısını gösterir. Hata alan bir sorgu başarılı tarama sayılmaz; sayaç girişimin sayısıdır.
- `UP` gibi isim parçaları yüzünden JUP/SUPER/SYRUP gibi olağan varlıkların elenmesi giderildi. Evren, scanner ve borsa sembol listesi aynı bilinen kaldıraçlı ürün kimliği kontrolünü kullanır. Bu liste ürün sınıflandırmasıdır; işlem yapılabilirlik ve borsa filtreleri ayrıca uygulanır.
- `scanner-context`, `scanner-ai`, `ensure-fresh-kline` abonelikleri aynı sahibin tekrar okumasında referans biriktirmez. 120 saniyelik yenilenebilir abonelikler kullanılır. Süre dolunca scanner referansı bırakılır, diğer sahiplerin referansları korunur. Scanner edinimleri 1024 stream sınırını aşamaz; kapasite reddi telemetride görünür. Tekrarlanan scanner okumaları yeniden bootstrap başlatmaz; açık REST recovery yolu korunur.
- Doğrulama parmak izi artık `services`, `lib`, `app/api` ve Prisma dosyalarını da kapsar. Bu bağımlılıklar değiştiğinde eski ekonomik sonuçlar güncel sayılmaz.

## Deney ve veri kapsamı

Önceki işlem testleri 10 büyük coinle sınırlıydı; üretim scanner'ının daha geniş evreninin tarihsel simülasyonu değildi. Ticker listesi ile Binance TR'nin gerçekten desteklediği liste de aynı sayıda değildir.

`python scripts/dataset/audit-try-opportunity-universe.py` Binance TR'nin `/open/v1/common/symbols` yanıtını saklar, TRY/type-1 çiftlerinin sabit 270 günlük günlük mumlarını public API'den çeker ve kaynakları/hash'leriyle saklar. Güncel liste tarihsel listeleme/delist kaydının yerine geçmez: survivorship bias açıkça işaretlidir. Günlük yüksek fiyatlar emir dolumu veya kâr değildir. Bu geniş günlük arşiv 308 coinlik dakikalık işlem backtesti olarak sunulmaz.

Bir BTC gününde yeni public günlük OHLCV ile yüklenen arşivin 1.440 dakikalık mumlarının birleşimi birebir eşleşti; bu tüm arşivin bağımsız doğrulaması değildir.

`npm run strategy:opportunities` aynı 10 coinlik dakikalık yürütme verisinde 30/60/90/270 gün, normal/stres maliyet ve üç adaydan oluşan 24 koşuyu çalıştırır. Beş dakikalık yeni girişin fiyat/hacim kırılması kuralı sonuçlara göre optimize edilmedi. Aynı giriş ailesi PR04 ve başlangıç riskine göre 2R aktivasyon/1R takip ile ayrı portföy koşularında karşılaştırılır. Çıkışlar farklı sonraki girişlere izin verebildiğinden bu sabit eşleştirilmiş giriş karşılaştırması değildir.

Yeni adaylar yalnızca `OPPORTUNITY_VARIANTS` içindedir; normal araştırma/üretim aday listelerinde değillerdir. `getVariantById` bunları kabul etmez. OI sinyali zorunluluğu olmadan yerel fiyat/hacim gözlemi kullanırlar; BTC bağlamı yalnızca kapanmış dış mumlardan gelir. Bir sonraki işlem gören dakika, hacim katılım sınırı, nakit/pozisyon/risk sınırları ve iki taraflı maliyetler korunur. Gün içi zirve emir fiyatı olarak kullanılmaz.

Günlük %1/%2/%3/%4 hedefi bütün hesabın gün sonu özkaynağından ölçülür. Nakit beklenen günler çıkarılmaz. Eksik gün sonu gözlemi sıfır getiriyle doldurulmaz.

## Ekonomik sonuç

10.000 TRY başlangıç, normal maliyet varsayımı; oranlar toplam hesap getirisi:

| Aday | 30 gün | 60 gün | 90 gün | Son 270 gün |
|---|---:|---:|---:|---:|
| Önceki saatlik yerel breakout | +%0,44 | -%0,13 | -%0,27 | -%4,48 |
| 5 dakika + PR04 | -%3,28 | -%8,01 | -%8,44 | -%8,06 |
| 5 dakika + risk bazlı takip | -%0,80 | -%5,88 | -%8,16 | -%6,94 |

Son 270 gün, önceki 270 günlük doğrulamanın tarih aralığıyla aynı değildir. İç içe pencereler bağımsız deneyler sayılmaz. Risk kesicisi bazı uzun koşularda yeni girişleri durdurur; düşük sonraki aktivite kârlılık değildir. İzlenen stop/günlük kayıp sınırı, boşluk ve gecikmeler nedeniyle kesin kayıp tavanı değildir.

Karar: OI-only veya yalnızca tarama hızını artırmayı ekonomik çözüm sayma. Bu turdaki hızlı adayları reddet. Kapsam/abonelik hatalarının giderilmesi fırsatların görülmesini düzeltir; kazandıran giriş-çıkış davranışını tek başına kanıtlamaz. Gelecekteki günlük asgari getiri şartı sağlanmış değildir.

## Doğrulama ve çalıştırma

- `npm run strategy:readiness`: ilgili birim testleri, iki TypeScript kontrolü, eski adayların 270 günlük doğrulaması ve 80 pencere/maliyet koşusu. Ekonomik veya PostgreSQL/paper kapısı geçmezse exit 2 beklenir.
- `npm run strategy:opportunities`: 24 sabit fırsat deneyi ve hesap bazlı günlük hedefler.
- `node node_modules/vitest/vitest.mjs run tests/fix2-binance-runtime-hardening.test.ts`: 8 runtime testi. Eski testin canonical breaker anahtarı yerine değişmeden kalan `operation` alanıyla devreyi bulması düzeltildi; başarım eşikleri değiştirilmedi.
- `npm run build`: uygulama derlemesi.

PostgreSQL production zinciri bu ortamda çalıştırılamadığından engineering durumunun bütünü PASS sayılmaz. Başarılı unit/build sonuçları paper işletiminin veya ekonomik başarının kanıtı değildir. Hesaba özgü komisyon ve tarihsel order book yoktur; simülasyon bunları doğrulanmış gibi sunmaz.

Public API sözleşmesi: https://www.binance.tr/apidocs/

## Tamamlanan geniş evren sayımı

308 desteklenen TRY/type-1 çiftinin sorgusu tamamlandı, HTTP/veri doğrulama hatası 0. 270 günlük aralıkta 80.380 aktif coin-günü bulundu; yeni listelenen veya işlem olmayan günler uydurulmadı.

| Pencere | Gün içi açılışa göre %20 tepe | Açılış-kapanış %20 |
|---|---:|---:|
| 30 gün | 287 | 69 |
| 60 gün | 486 | 116 |
| 90 gün | 777 | 180 |
| 270 gün | 2.219 | 524 |

Bunlar coin-günü sayılarıdır, 2.219 alınabilir kazançlı işlem değildir. Güncel listeye bağlı seçilim ve günlük mum çözünürlüğü nedeniyle bu dosya strateji terfi kanıtı değildir. Ayrıntılı kaynak/hash özeti `artifacts/opportunity-delivery/wide-universe.json` içindedir. Ham günlük yanıtlar yerelde `artifacts/try-universe-audit/*.json.gz` olarak saklanır, Git yamasına eklenmez; downloader ile yeniden alınabilir.

Son doğrulama: 125 ilgili test + 8 runtime testi, iki TypeScript kontrolü ve uygulama build PASS. 10 uzun doğrulama + 80 pencere koşusu + 24 fırsat karşılaştırması tamamlandı. Strateji FAIL, paper BLOCKED, PostgreSQL production zinciri UNAVAILABLE. GitHub bağlantısı yazma işlemine 403 döndü.
