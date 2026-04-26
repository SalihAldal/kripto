# Production Checklist

## Security
- [ ] `APP_TOKEN` production değeri set edildi
- [ ] `BINANCE_API_KEY` / `BINANCE_API_SECRET` sadece server environment içinde
- [ ] `BINANCE_DRY_RUN=false` geçişi kontrollü yapıldı
- [ ] Kritik endpointler token korumalı test edildi

## Infrastructure
- [ ] PostgreSQL healthcheck başarılı
- [ ] Redis healthcheck başarılı
- [ ] `GET /api/health/live` 200 dönüyor
- [ ] `GET /api/health/ready` 200 dönüyor
- [ ] `GET /api/health` heartbeats/circuit snapshot veriyor

## Database
- [ ] `npm run prisma:migrate:deploy` tamamlandı
- [ ] `npm run prisma:seed` tamamlandı
- [ ] Risk/trade/scanner tablolarında veri akışı doğrulandı

## Runtime Safety
- [ ] Risk gate kuralları aktif
- [ ] `system.paused` durumu UI üzerinde görünüyor
- [ ] Emergency stop testi yapıldı
- [ ] API failure breaker / consecutive loss breaker davranışı doğrulandı

## Observability
- [ ] Request logging aktif
- [ ] Trade lifecycle logları düşüyor
- [ ] AI request/response safe logları doğrulandı
- [ ] Log paneli memory + DB birleşik kayıt gösteriyor

## Quality Gates
- [ ] `npm run lint`
- [ ] `npm run test:run`
- [ ] `npm run build`
