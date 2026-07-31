import { NextRequest } from "next/server";
import { env } from "@/lib/config";
import { getExchangeProvider } from "@/src/server/exchange";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.toUpperCase() ?? (env.BINANCE_PLATFORM === "tr" ? "BTCTRY" : "BTCUSDT");
  const provider = getExchangeProvider();
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      unsubscribe = provider.subscribeTicker(symbol, (tick) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(tick)}\n\n`));
      });
      controller.enqueue(encoder.encode("event: ready\ndata: connected\n\n"));
    },
    cancel() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
