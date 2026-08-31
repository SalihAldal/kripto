export function isTransientPrismaConnectivityError(error: unknown) {
  const message = (error as Error)?.message?.toLowerCase?.() ?? "";
  if (message.includes("p1001") || message.includes("p1002")) return true;
  if (message.includes("can't reach database server")) return true;
  if (message.includes("database") && message.includes("timed out")) return true;
  if (
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("connection reset") ||
    message.includes("socket hang up") ||
    message.includes("network")
  ) {
    return true;
  }
  return false;
}
