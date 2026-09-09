import { describe, expect, it } from "vitest";
import { recentDiagnosticWindows } from "@/src/server/trade-decision-core/window-diagnostics.service";
const DAY = 86400000, start = Date.parse("2025-09-01T00:00:00Z"), end = Date.parse("2026-08-31T23:59:59.999Z");
describe("recent diagnostic window boundaries", () => {
    it("anchors 30/60/90 days at archive end and partitions the last 90 days without gaps", () => {
        const windows = recentDiagnosticWindows(start, end);
        expect(windows.slice(0, 3).map(w => w.end)).toEqual([end, end, end]);
        expect(windows.slice(0, 3).map(w => (w.end - w.start + 1) / DAY)).toEqual([30, 60, 90]);
        const blocks = [windows[4], windows[3], windows[0]];
        expect(blocks[0].start).toBe(windows[2].start);
        expect(blocks[0].end + 1).toBe(blocks[1].start);
        expect(blocks[1].end + 1).toBe(blocks[2].start);
        expect(blocks[2].end).toBe(end);
    });
    it("refuses incomplete UTC days and insufficient warmup", () => {
        expect(() => recentDiagnosticWindows(start, end - 1)).toThrow("INVALID_WINDOW_DATASET");
        expect(() => recentDiagnosticWindows(end - 90 * DAY + 1, end)).toThrow("INVALID_WINDOW_DATASET");
    });
});
