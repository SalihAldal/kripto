-- Structured logging and audit performance indexes

CREATE INDEX IF NOT EXISTS "SystemLog_createdAt_idx" ON "SystemLog" ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "SystemLog_context_actionType_idx" ON "SystemLog" (((context->>'actionType')));
CREATE INDEX IF NOT EXISTS "SystemLog_context_status_idx" ON "SystemLog" (((context->>'status')));
CREATE INDEX IF NOT EXISTS "SystemLog_context_symbol_idx" ON "SystemLog" (((context->>'symbol')));
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx" ON "AuditLog" ("action", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AuditLog_entityType_createdAt_idx" ON "AuditLog" ("entityType", "createdAt" DESC);
