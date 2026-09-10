# Birleşik yama: tarama, paper gözetimi ve öğrenme doğruluğu

Bu teslim `2a44028396694762499401fd8f6d62ed4e0b88ab` üzerine uygulanır. Önceki `KRIPTO_OPPORTUNITY_CAPTURE.patch` içindeki değişiklikleri de içerir; eski yamayı ayrıca uygulamayın. Tarama düzeltmeleri ve tarihsel fırsat deneylerinin ayrıntıları `OPPORTUNITY_CAPTURE_CHANGES.md` içindedir.

## Bu tur eklenenler

- Öğrenme PF'si artık beklentiden uydurulmaz; bildirilen yüzde getirilerin pozitif/negatif toplamlarından hesaplanır. Kayıpsız örnekte sonsuz/sahte PF üretilmez. Eski backfill kayıtlarının fiyat getirisi komisyon sonrası net getiri değildir: maliyet temeli doğrulanmayan pozitif örnekler WINNING olarak terfi ettirilmez. Farklı paper/live modlarının karışımı da kazanma kanıtı sayılmaz. Bu eşit büyüklükte işlem varsayımına dayanan ölçüdür, hesap düzeyinde nakit PF değildir.
- Aynı trade için öğrenme hafızası ve aynı bilgi girdisi kararlı kimlikle upsert edilir; her öğrenme turu aynı veriyi yeniden çoğaltmaz. Önceden birikmiş kopyalar otomatik silinmez. Eksik kalite puanı sıfır olarak uydurulmaz, işlem artışı tahmini kazanma oranı artışı gibi gösterilmez. Öğrenme adımlarının hataları başarı olarak yutulmaz; oturum FAILED olur.
- 33 gerçek araştırma özeti kaynak dosyası SHA256'sı, bilgiye erişim zamanı ve kapsam sınırlamalarıyla paketlenmiştir: 5 temel aday sonucu, 24 pencere/maliyet deneyi, 4 geniş evren özeti. Bunlar bağımsız 33 doğrulama veya gerçekleşmiş işlem değildir. Bilgi tabanına eklenir; trade/label tablosuna, model ağırlıklarına veya canlı terfiye yazılmaz. Günlük öz eleştiri ve haftalık araştırma bağlamına uygun tarih filtresiyle girer. Amaç daha önce kaybettiren hipotezleri ve günlük tepe sayısının neden işlem kârı olmadığını hatırlatmaktır.
- Paper gözetimi, açık pozisyon yokken 10 dakika gerçek tur ilerlemesi olmamasını veya art arda üç tanımlı teknik hata görülmesini kaydeder ve durdurma ister. Açık pozisyon varken bu watchdog durdurmaz. Sağlıklı `NO_VALID_SETUP` turları teknik hata sayılmaz; işlem zorlanmaz. Job metadata güncellemesi mevcut alanları silmeden atomik birleştirilir. DB ön kontrolü artık uygulama tablosuna erişim hatasını gizlemez.

## Tek uygulama

Proje köküne birleşik yama dosyasını koyup:

```powershell
git apply --check KRIPTO_COMBINED_PAPER_LEARNING.patch
git apply KRIPTO_COMBINED_PAPER_LEARNING.patch
npm run learning:seed -- --check
```

Mevcut proje bağımlılıkları ve migrate edilmiş PostgreSQL gerekir; bu değişiklik şema migration'ı eklemez. `.env` içinde çalışan projenin DB ve servis ayarları bulunmalıdır. Araştırma kayıtlarını hemen mevcut bilgi tabanına yazmak için:

```powershell
npm run learning:seed
```

Ayrıca mevcut `KNOWLEDGE_BUILD` öğrenme görevi bu kayıtları kendisi senkronize eder. Tekrar çalıştırmak yeni kopyalar oluşturmaz.

Teknik gözlem amacıyla mevcut üretim scanner zincirinin 12 saat paper komutu:

```powershell
npm run paper:supervised -- --hours=12
```

Runner paper modunu zorunlu kılar, live yetkisini kapatır ve mevcut teknik preflight'ı uygular. Bu komut strateji kabulünden geçmiş TDC smoke testi değildir; legacy üretim scanner'ının ileriye dönük gözlemidir. TDC ekonomik kapısı başarısızken açılmamalıdır. `kripto-8h-paper-result.json` içinde gerçek süre, durma nedeni ve tur nedenleri; `artifacts/paper-campaigns/` altında ilerleme kayıtları oluşur. 12 saatte işlem veya kazanç garantisi yoktur. Teknik sorunla erken biten koşuyu süre tamamlandı diye saymayın.

## Kanıt ve sınır

Güncel doğrulama çıktıları `artifacts/paper-learning-delivery/` içindedir. 138 ilgili test ve iki TypeScript kontrolü geçti; uygulama derlemesi geçti. Eski fırsat deneyleri kaynaklarıyla tarihsel bilgi olarak korunur; yeni kâr kanıtı diye yeniden etiketlenmez.

Bu ortamda PostgreSQL ve kullanıcı `.env` ayarları yok: gerçek paper zinciri çalıştırılmadı, kullanıcının veritabanına seed uygulanmadı. Sanal saatli watchdog testi 15 saatlik talebin 10 dakika teknik durgunlukta durmasını doğrular; gerçek 15 saat paper sonucu değildir.

Ekonomik durum FAIL; TDC paper uygun adayı yok, live kapalı. Bu paket günlük %1–4 veya ileriye dönük pozitif getiri sağlayan sistem teslimi değildir. Sağlamlaştırılan teknik davranışla kanıtlanmamış ekonomik sonucu birbirinden ayırın. Gerçek ileriye dönük paper sonuçları olmadan 10–15 saatin kaç işlem veya ne kadar kâr getireceği hesaplanamaz.
