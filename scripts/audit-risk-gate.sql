SELECT reason, COUNT(*)::int AS count
FROM "TradeEventLog"
WHERE "eventType" = 'RISK_GATE_BLOCKED'
GROUP BY reason
ORDER BY count DESC
LIMIT 20;
