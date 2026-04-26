# Database Migration Runbook

## Normal Akis

Development:
```bash
npm run prisma:migrate
```

Stage/Prod:
```bash
npm run prisma:migrate:deploy
```

Durum kontrolu:
```bash
npm run prisma:migrate:status
```

## Seed Ayrimi

- Zorunlu seed: `npm run prisma:seed`
- Opsiyonel seed: `npm run prisma:seed:optional`
- Production'da seed'i sadece gerekli baslangic verisi icin kullan.

## Rollback Plani

Prisma dogrudan otomatik down-migration calistirmaz. Guvenli rollback yaklasimi:

1. **Deployment oncesi DB backup al**
2. Hata olursa:
   - Uygulama versiyonunu geri al
   - Gerekirse backup restore et
3. Migrate state tutarsizligi varsa:
```bash
npm run prisma:rollback:plan
```
ve `prisma migrate resolve` ile durumu manuel hizala.

## Acil Durum Checklist

- [ ] Son backup alinmis mi?
- [ ] `prisma migrate status` temiz mi?
- [ ] Uygulama versiyonu DB semasi ile uyumlu mu?
- [ ] Readiness endpoint (`/api/health/ready`) 200 donuyor mu?
