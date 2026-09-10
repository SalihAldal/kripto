export function isTransientPrismaConnectivityError(error: unknown) {
  const code = String((error as { code?: string })?.code ?? "").toUpperCase();
  if (code === "P2024") return true;
  const message = (error as Error)?.message?.toLowerCase?.() ?? "";
  if (message.includes("p1001") || message.includes("p1002") || message.includes("p2024")) return true;
  if (message.includes("connection pool") && message.includes("timeout")) return true;
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
