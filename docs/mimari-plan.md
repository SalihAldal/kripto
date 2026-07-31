# Uygulamaya Donusum Plani

## Prensip

Mevcut arayuz yeniden tasarlanmayacak; birebir tasarim dili korunarak canli veri ve is mantigi baglanacak.

## Asama Plani

1. **UI Haritalama**
   - Her HTML dosyasini route bazli map et.
   - Ortak shell (`TopNav`, `SideNav`, `PanelCard`) bilesenlerine ayir.

2. **Feature Modulleri**
   - `market`: ticker, scan, realtime feed
   - `ai`: model provider + consensus
   - `trading`: open/close, history, pnl
   - `risk`: limits, guardrails, emergency actions
   - `logs`: sistem ve islem loglari

3. **Server Katmani**
   - API route + service layer ayrimi
   - Binance adapter
   - Redis cache/ephemeral state
   - Prisma persistence

4. **State ve UX**
   - loading / error / empty / retry state standartlari
   - optimistic UI sadece gerekli aksiyonlarda

5. **Production Hazirlik**
   - env tabanli config
   - token auth + rate limit
   - structured logging + rotating log strategy
