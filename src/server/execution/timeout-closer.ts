export function isExecutionTimedOut(openedAt: string | Date, maxDurationSec: number, now = Date.now()) {
  const started = typeof openedAt === "string" ? new Date(openedAt).getTime() : openedAt.getTime();
  return now - started >= maxDurationSec * 1000;
}
