export function buildClientOrderIdFromExitIntent(exitIntentId: string) {
  const normalized = String(exitIntentId ?? "").trim();
  if (!normalized) return null;
  return `fix02-${normalized}`.slice(0, 36);
}

