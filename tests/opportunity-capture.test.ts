import { expect, it } from "vitest";
import { opportunityDays, dailyAccountTargets } from "@/src/server/trade-decision-core/opportunity-capture.service";
it("separates intrabar peaks, observable closes and next-minute remaining movement", () => {
  const bars = [100, 103, 105, 106, 101].map((close, i) => ({ openTime: i * 60000, closeTime: (i+1)*60000-1, open: close, close, high: i === 0 ? 130 : close, low: close, volume: 1, quoteVolume: close, takerBuyQuote: 0 }));
  const [d] = opportunityDays("TESTTRY", bars);
  expect(d.intrabarHighReturnPct).toBeCloseTo(30);
  expect(d.peakCloseReturnPct).toBeCloseTo(6);
  expect(d.closeReturnPct).toBeCloseTo(1);
  expect(d.firstTwoPctAt).toBe(119999);
  expect(d.remainingPeakAfterNextMinutePct).toBeCloseTo((106/105-1)*100);
});
it("measures account targets including cash days and fails on missing day-end marks", () => {
  const D = 86400000, equity = [10100,10100,9999].map((equityTry,i) => ({ atMs: (i+1)*D-1, equityTry, cashTry: equityTry, openPositions: 0 }));
  const r = dailyAccountTargets(equity, 10000, 0, 3*D-1);
  expect(r.status).toBe("COMPLETE");
  expect(r.flatDays).toBe(1); expect(r.negativeDays).toBe(1);
  expect(r.targets?.[0].daysMet).toBe(1); expect(r.targets?.[0].everyDayMet).toBe(false);
  expect(dailyAccountTargets(equity.slice(1), 10000, 0, 3*D-1).status).toBe("INCOMPLETE_DAY_BOUNDARIES");
});
