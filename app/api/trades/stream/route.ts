import { NextRequest } from "next/server";
import { ensureTradeMonitors, listTradeExecutionEvents, listTradeLifecycleEvents } from "@/services/trading-engine.service";
import { subscribeExecutionEvents } from "@/src/server/execution/execution-event-bus";
import { enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { isProd } from "@/lib/config";
import { getRequestLocale } from "@/lib/request-locale";

function isLocalSameOriginStream(request: NextRequest) {
  if (isProd) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "";
  const localForwarded = forwardedFor === "::1" || forwardedFor === "127.0.0.1" || forwardedFor === "::ffff:127.0.0.1";
  const localHost = request.nextUrl.hostname === "localhost" || request.nextUrl.hostname === "127.0.0.1";
  return localHost && localForwarded && (!fetchSite || fetchSite === "same-origin");
}

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  const limited = enforceRateLimit(request);
  if (limited) return limited;
  if (!isLocalSameOriginStream(request) && !checkApiToken(request)) {
    return Response.json({ ok: false, error: tr ? "Yetkisiz." : "Unauthorized." }, { status: 401 });
  }
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
