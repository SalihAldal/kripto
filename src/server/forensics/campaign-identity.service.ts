import { randomUUID } from "node:crypto";

const CAMPAIGN_PREFIX = "cmp";

function clean(value?: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function buildCampaignId(input: {
  campaignId?: string | null;
  jobId?: string | null;
  sessionId?: string | null;
  startedAt?: string | null;
}) {
  const explicit = clean(input.campaignId);
  if (explicit) return explicit;
  const base = clean(input.jobId) ?? clean(input.sessionId);
  if (base) return `${CAMPAIGN_PREFIX}:${base}`;
  const ts = clean(input.startedAt)?.replace(/[^0-9TZ]/g, "") ?? new Date().toISOString().replace(/[^0-9TZ]/g, "");
  return `${CAMPAIGN_PREFIX}:adhoc:${ts}:${randomUUID().slice(0, 8)}`;
}

export function assertCampaignId(value?: string | null) {
  const campaignId = clean(value);
  if (!campaignId) {
    throw new Error("CAMPAIGN_IDENTITY_MISSING");
  }
  return campaignId;
}
