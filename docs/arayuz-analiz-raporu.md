# Arayuz Analiz Raporu

## Genel Tespit

- `arayuz` klasorunde 11 adet HTML dosyasi var.
- Harici lokal CSS/JS/PNG dosyasi yok.
- Tasarim, dosya icindeki inline stiller + Tailwind CDN siniflariyla kurulmus.
- Ikonlar Google Material Symbols fontundan geliyor.
- Gorsellerin buyuk bolumu uzak URL (`lh3.googleusercontent.com`) olarak kullanilmis.
- Sayfalarda islevsel JS yok; sadece `tailwind-config` scripti var.

## Sayfa Haritasi

- `code.html`: Giris ekrani
- `10.html`: Ana dashboard / portfolio overview
- `3.html`: AI market watch
- `4.html`: Mobile live trading / one-tap execution
- `5.html`: Deep AI analysis
- `6.html`: Trade history / execution ledger
- `7.html`: Strategy settings
- `8.html`: Risk management
- `9.html`: System logs ve diagnostics
- `2.html`: Profile & security
- `1.html`: System command / node health

## Bilesen Tipleri

- Sabit top navbar + sol sidebar
- KPI kartlari (PnL, win-rate, latency, status)
- Grid / bento layout paneller
- Tablo alanlari (trade history, trend scanner, matrix)
- Terminal/log akisi panelleri
- Radar/chart benzeri statik grafik bloklari
- Ayar formlari, slider, toggle, aksiyon butonlari

## Davranis Tespiti

- Interaktivite gorsel seviyede; gercek veri baglantisi yok.
- Butonlar, toggle ve tablolar statik mock.
- Canli veri simulasyonu sadece metinsel/gorsel temsil.
