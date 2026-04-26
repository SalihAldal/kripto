import { ensureTradeMonitors, listTradeExecutionEvents, listTradeLifecycleEvents } from "@/services/trading-engine.service";
import { subscribeExecutionEvents } from "@/src/server/execution/execution-event-bus";

export async function GET() {
  await ensureTradeMonitors().catch(() => null);
  const persisted = await listTradeLifecycleEvents({ limit: 80 }).catch(() => []);
  const memory = listTradeExecutionEvents(80);
  const initial = [...persisted, ...memory]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 80);
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      const safeEnqueue = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          closed = true;
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
        }
      };

      safeEnqueue(`event: snapshot\ndata: ${JSON.stringify(initial)}\n\n`);

      unsubscribe = subscribeExecutionEvents((event) => {
        safeEnqueue(`data: ${JSON.stringify(event)}\n\n`);
      });
      cleanup = () => {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      };

      safeEnqueue("event: ready\ndata: connected\n\n");
    },
    pull() {
      // keep stream active
    },
    cancel() {
      if (cleanup) cleanup();
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
