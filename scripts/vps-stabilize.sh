#!/usr/bin/env bash
# VPS kurtarma ve CPU/RAM stabilizasyon scripti
# Kullanim: cd /var/www/kriptopaneli && bash scripts/vps-stabilize.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/kriptopaneli}"
ENV_FILE="${APP_DIR}/.env"

cd "$APP_DIR"

echo "=== VPS Stabilize — $(date -Is) ==="

# 1) Guvenlik taramasi (Hostinger malware uyarisi icin)
echo ""
echo "--- [1/6] Guvenlik kontrolu ---"
echo "Yuksek CPU processler:"
ps aux --sort=-%cpu | head -n 12
echo ""
echo "Bilinmeyen cron:"
crontab -l 2>/dev/null || echo "(cron yok)"
echo ""
echo "/tmp suspekt dosyalar:"
find /tmp -maxdepth 2 -type f \( -name "*.sh" -o -name "xmrig*" -o -name "kdevtmpfsi*" -o -name "kinsing*" \) 2>/dev/null | head -n 20 || true

# 2) Kaynak durumu
echo ""
echo "--- [2/6] Kaynak durumu ---"
free -h
df -h /
echo ""

# 3) PM2 durdur (sakin baslat)
echo "--- [3/6] PM2 durduruluyor ---"
pm2 stop all 2>/dev/null || true

# 4) .env stabilizasyon ayarlari
echo "--- [4/6] .env ayarlari kontrol ---"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "HATA: $ENV_FILE bulunamadi"
  exit 1
fi

set_env() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
  echo "  ${key}=${val}"
}

set_env ENABLE_SEPARATE_WORKER true
set_env HOT_PATH_V2_FREEZE_ENABLED true
set_env HOT_PATH_LEGACY_WORKERS_ENABLED false
set_env HOT_PATH_MAX_CRITICAL_WORKERS 4
set_env SCANNER_WORKER_INTERVAL_MS 300000
set_env SCANNER_WORKER_WITH_AI false
set_env SCANNER_AI_CONCURRENCY 2
set_env SCANNER_TOP_CANDIDATES 10
set_env SCANNER_CYCLE_SYMBOL_LIMIT 50
set_env SCANNER_MAX_CYCLE_SEC 300
set_env SCANNER_CONTEXT_CONCURRENCY 6
set_env PUMP_EARLY_CATCHER_INTERVAL_MS 30000
set_env PUMP_EARLY_CATCHER_BATCH_SIZE 32
set_env LIVE_TRADING_PLATFORM_ENABLED false
set_env PAPER_VALIDATION_PLATFORM_ENABLED false
set_env AUTO_ROUND_MAX_SELECTION_ATTEMPTS 3
set_env AUTO_ROUND_SELECTION_BUDGET_SEC 1200
set_env AUTO_ROUND_SCAN_CYCLES 1

# 5) Zombie auto-round job durdur
echo ""
echo "--- [5/6] Zombie auto-round job kontrol ---"
if command -v docker &>/dev/null; then
  docker compose exec -T postgres psql -U kinetic -d kinetic -c "
    UPDATE \"AutoRoundJob\"
    SET status = 'STOPPED', \"stopRequested\" = true, \"updatedAt\" = NOW()
    WHERE status = 'RUNNING';
    SELECT id, status, \"currentRound\", \"failedRounds\", \"lastError\"
    FROM \"AutoRoundJob\"
    ORDER BY \"updatedAt\" DESC LIMIT 3;
  " 2>/dev/null || echo "(postgres sorgusu atlandi — docker/psql erisilemedi)"
fi

# Log temizligi
echo ""
echo "Log dosyalari kirpiliyor..."
truncate -s 0 logs/pm2-web.out.log logs/pm2-web.err.log logs/pm2-worker.err.log 2>/dev/null || true
pm2 flush 2>/dev/null || true

# 6) PM2 yeniden baslat
echo ""
echo "--- [6/6] PM2 yeniden baslat ---"
pm2 start ecosystem.config.cjs --only kinetic-web
sleep 5
free -h
pm2 start ecosystem.config.cjs --only kinetic-worker
sleep 3
pm2 list
pm2 save

echo ""
echo "=== Tamamlandi. 2 dakika bekle, sonra kontrol et: ==="
echo "  top -bn1 | head -20"
echo "  pm2 logs kinetic-worker --lines 30 --nostream"
echo ""
echo "Auto-round'u elle baslatmadan once CPU <%50 olmali."
