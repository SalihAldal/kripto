import { LivePaperEngine } from "@/src/server/trading-core/paper/live-paper-engine";
import type { LivePaperEngineOptions } from "@/src/server/trading-core/paper/live-paper-types";

let engine: LivePaperEngine | null = null;

export function getLivePaperEngine(options?: LivePaperEngineOptions) {
  if (!engine) engine = new LivePaperEngine(options);
  return engine;
}

export function resetLivePaperEngine(options?: LivePaperEngineOptions) {
  engine = new LivePaperEngine(options);
  return engine;
}
