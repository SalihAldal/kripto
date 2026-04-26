import { ensureScannerWorkerStarted, getScannerWorkerSnapshot } from "@/src/server/scanner";
import type { ScannerPipelineResult } from "@/src/types/scanner";

const EMPTY_SCAN_RESULT: ScannerPipelineResult = {
  scannedAt: new Date(0).toISOString(),
  totalSymbols: 0,
  qualifiedSymbols: 0,
  aiEvaluatedSymbols: 0,
  candidates: [],
};

export async function GET(request: Request) {
  ensureScannerWorkerStarted();
  const encoder = new TextEncoder();
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "market";
  const intervalMs = Math.max(3000, Math.min(Number(url.searchParams.get("intervalMs") ?? "8000"), 60000));

  let interval: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
          if (interval) clearInterval(interval);
        }
      };

      const send = () => {
        const snapshot = getScannerWorkerSnapshot();
        const payload = mode === "detailed" ? (snapshot.detailed ?? EMPTY_SCAN_RESULT) : snapshot.rows;
        safeEnqueue(`data: ${JSON.stringify(payload)}\n\n`);
      };

      send();
      interval = setInterval(send, intervalMs);
      safeEnqueue("event: ready\ndata: connected\n\n");
    },
    cancel() {
      closed = true;
      if (interval) clearInterval(interval);
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
