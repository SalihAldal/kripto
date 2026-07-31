import type { MarketContext } from "@/src/types/scanner";

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type PumpEntrySafetyResult = {
  ok: boolean;
  bucket: string;
  reason: string;
};

export function evaluatePumpEntrySafety(input: {
  context: MarketContext;
  tapeMomentum?: number;
  hourMomentum?: number;
  shortFlow?: number;
  change24h?: number;
  pumpStage?: string;
  marketRegime?: string;
  compositeAvg?: number;
}): PumpEntrySafetyResult {
  const meta = input.context.metadata;
  const tapeMomentum = num(input.tapeMomentum ?? meta.shortMomentumPercent);
  const hourMomentum = num(input.hourMomentum ?? meta.hourMomentumPercent);
  const shortFlow = num(input.shortFlow ?? meta.shortFlowImbalance);
  const change24h = num(input.change24h ?? meta.topGainerChange24h ?? input.context.change24h);
  const pumpStage = String(input.pumpStage ?? meta.pumpBreakoutStage ?? "");
  const marketRegime = String(input.marketRegime ?? meta.marketRegime ?? "");
  const compositeAvg = num(input.compositeAvg);
  const distanceFrom60mHighPercent = num(meta.distanceFrom60mHighPercent, 999);
  const extensionFrom60mLowPercent = num(meta.extensionFrom60mLowPercent);
  const redCandleCount5 = num(meta.redCandleCount5);
  const dump15mPercent = num(meta.dump15mPercent);

  const pass = (bucket = "", reason = ""): PumpEntrySafetyResult => ({ ok: true, bucket, reason });
  const fail = (bucket: string, reason: string): PumpEntrySafetyResult => ({ ok: false, bucket, reason });

  if (dump15mPercent <= -3) {
    return fail("DUMP_TESPITI", `Dump: son 15dk ${dump15mPercent.toFixed(2)}%`);
  }

  if (dump15mPercent <= -1.2 && (tapeMomentum < 1.1 || shortFlow < 0.45)) {
    return fail(
      "DUMP_BASLANGICI",
      `Pump icinde dump baslangici (15dk=${dump15mPercent.toFixed(2)}%, tape=${tapeMomentum.toFixed(2)}%, flow=${shortFlow.toFixed(3)})`,
    );
  }

  if (dump15mPercent < 0 && redCandleCount5 >= 2 && tapeMomentum < 0.8) {
    return fail(
      "PULLBACK_DUMP",
      `Pullback/dump teyidi (15dk=${dump15mPercent.toFixed(2)}%, red5=${redCandleCount5}, tape=${tapeMomentum.toFixed(2)}%)`,
    );
  }

  if (hourMomentum < 0) {
    return fail("HOUR_NEGATIF", `Saatlik momentum negatif (${hourMomentum.toFixed(2)}%)`);
  }

  // Saatlik %3-5 yükselişler için eşiği düşür: hourMomentum >= 0.15 veya tape >= 0.08 yeterli
  if (hourMomentum < 0.15 && tapeMomentum < 0.5) {
    return fail("HOUR_ZAYIF", `Saatlik momentum zayif (hour=${hourMomentum.toFixed(2)}%, tape=${tapeMomentum.toFixed(2)}%)`);
  }

  if (marketRegime === "HIGH_VOLATILITY_CHAOS") {
    if (dump15mPercent <= -0.6 || (redCandleCount5 >= 2 && tapeMomentum < 1.4)) {
      return fail(
        "CHAOS_PULLBACK",
        `Chaos rejiminde pullback riski (15dk=${dump15mPercent.toFixed(2)}%, red5=${redCandleCount5}, tape=${tapeMomentum.toFixed(2)}%)`,
      );
    }
    const chaosNeedsStrongTape =
      (pumpStage !== "EARLY" && pumpStage !== "ACTIVE") ||
      change24h < 20 ||
      tapeMomentum < 1.35 ||
      shortFlow < 0.55;
    if (chaosNeedsStrongTape) {
      return fail(
        "CHAOS_ZAYIF_TAPE",
        `Chaos rejiminde zayif tape/flow (stage=${pumpStage}, 24h=${change24h.toFixed(2)}%, tape=${tapeMomentum.toFixed(2)}%, flow=${shortFlow.toFixed(3)})`,
      );
    }
  }

  if (tapeMomentum <= 0 && change24h >= 12) {
    return fail("TAPE_NEGATIF", `Tape negatif (${tapeMomentum.toFixed(3)}%) yuksek 24h pump sonrasi`);
  }

  if (marketRegime === "LOW_VOLATILITY_CALM" && tapeMomentum < 0.08) {
    return fail("CALM_OLU_TAPE", `CALM rejim + olu tape (${tapeMomentum.toFixed(3)}%, hour=${hourMomentum.toFixed(2)}%)`);
  }

  if (tapeMomentum < 0.08 && hourMomentum >= 1.2 && hourMomentum < 2.5 && shortFlow >= 0.22) {
    return fail("SAHTE_HOUR_PUMP", `Sahte hour-only (tape=${tapeMomentum.toFixed(3)}%, hour=${hourMomentum.toFixed(2)}%)`);
  }

  if (change24h >= 28 && tapeMomentum < 0.55) {
    return fail("YORGUN_PUMP", `Yorgun mega-pump (24h=${change24h.toFixed(1)}%, tape=${tapeMomentum.toFixed(2)}%)`);
  }

  if (change24h >= 20 && tapeMomentum < 0.2 && hourMomentum < 1.5) {
    return fail("PUMP_BITMIS", `Pump bitmis (24h=${change24h.toFixed(1)}%, tape=${tapeMomentum.toFixed(2)}%, hour=${hourMomentum.toFixed(2)}%)`);
  }

  if (change24h >= 15 && distanceFrom60mHighPercent <= 5 && tapeMomentum < 1.5) {
    return fail("TEPE_YAKINI", `Tepe yakininda giris (tepeye ${distanceFrom60mHighPercent.toFixed(2)}%, tape=${tapeMomentum.toFixed(2)}%)`);
  }

  if (extensionFrom60mLowPercent >= 35 && change24h >= 22 && tapeMomentum < 1.2) {
    return fail("ASIRI_UZAMA", `Asiri uzama (1s +${extensionFrom60mLowPercent.toFixed(1)}%, 24h=${change24h.toFixed(1)}%, tape=${tapeMomentum.toFixed(2)}%)`);
  }

  if (change24h >= 15 && distanceFrom60mHighPercent <= 3 && tapeMomentum < 0.8) {
    return fail("TEPE_KOVASI", `Tepe kovalamasi (24h=${change24h.toFixed(1)}%, tepeye ${distanceFrom60mHighPercent.toFixed(2)}%, tape=${tapeMomentum.toFixed(2)}%)`);
  }

  if ((pumpStage === "ACTIVE" || marketRegime === "ROCKET_PUMP") && change24h < 12) {
    const decisiveTape = tapeMomentum >= 1.2 && shortFlow >= 0.55 && hourMomentum >= 2 && compositeAvg >= 70;
    if (!decisiveTape) {
      return fail(
        "ZAYIF_PUMP_ONCELIK",
        `Dusuk 24h pump icin tape yetersiz (24h=${change24h.toFixed(2)}%, tape=${tapeMomentum.toFixed(2)}%, hour=${hourMomentum.toFixed(2)}%, flow=${shortFlow.toFixed(3)})`,
      );
    }
  }

  if (marketRegime === "ROCKET_PUMP" && change24h < 15 && tapeMomentum < 1.05) {
    return fail(
      "ROCKET_ZAYIF_TAPE",
      `ROCKET pump ama canli tape zayif (24h=${change24h.toFixed(2)}%, tape=${tapeMomentum.toFixed(2)}%, hour=${hourMomentum.toFixed(2)}%)`,
    );
  }

  if (change24h >= 12 && redCandleCount5 >= 3 && tapeMomentum < 0.25) {
    return fail("PULLBACK_RISKI", `Pullback riski (${redCandleCount5}/5 kirmizi, tape=${tapeMomentum.toFixed(2)}%)`);
  }

  if (pumpStage === "LATE") {
    const hourTapeRatio = hourMomentum / Math.max(tapeMomentum, 0.01);
    if (tapeMomentum < 0.85 || shortFlow < 0.52) {
      return fail("GEC_GIRIS", `LATE zayif tape/flow (tape=${tapeMomentum.toFixed(2)}%, flow=${shortFlow.toFixed(3)})`);
    }
    if (hourTapeRatio > 3.0) {
      return fail(
        "HOUR_TAPE_UYUMSUZ",
        `LATE hour/tape uyumsuz (hour=${hourMomentum.toFixed(2)}%, tape=${tapeMomentum.toFixed(2)}%, ratio=${hourTapeRatio.toFixed(2)})`,
      );
    }
    if (compositeAvg > 0 && compositeAvg < 70) {
      return fail("GEC_GIRIS", `LATE dusuk composite (${compositeAvg.toFixed(1)} < 70)`);
    }
  }

  if (pumpStage === "LATE" && tapeMomentum < 0.35 && hourMomentum < 2.5) {
    return fail("GEC_GIRIS", `Gec giris LATE (tape=${tapeMomentum.toFixed(2)}%, hour=${hourMomentum.toFixed(2)}%)`);
  }

  const minTape =
    change24h >= 25 ? 0.55 : change24h >= 15 ? 0.4 : change24h >= 8 ? 0.22 : 0.15;
  const strongLiveTape = tapeMomentum >= minTape && shortFlow >= 0.42 && hourMomentum >= 0.5;
  const strongMomentum =
    tapeMomentum >= 0.85 && shortFlow >= 0.5 && hourMomentum >= 1.2;
  const earlyBreakout =
    (pumpStage === "EARLY" || pumpStage === "ACTIVE") &&
    tapeMomentum >= 0.35 &&
    shortFlow >= 0.38 &&
    hourMomentum >= 0.65;

  if (!strongLiveTape && !strongMomentum && !earlyBreakout) {
    if (compositeAvg > 0 && compositeAvg < 62 && tapeMomentum < 0.5) {
      return fail(
        "TAPE_YETERSIZ",
        `Tape yetersiz (tape=${tapeMomentum.toFixed(2)}% < ${minTape}%, composite=${compositeAvg.toFixed(1)})`,
      );
    }
    if (tapeMomentum < minTape && !(hourMomentum >= 2.8 && shortFlow >= 0.55 && tapeMomentum >= 0.05)) {
      return fail(
        "TAPE_YETERSIZ",
        `Canli tape yok (tape=${tapeMomentum.toFixed(2)}% < ${minTape}%, hour=${hourMomentum.toFixed(2)}%)`,
      );
    }
  }

  // TRY piyasasında %3-5 arası saatlik yükselişler geçerli pump sinyali; 24h tabanını 3'e düşür
  if (change24h < 3) {
    return fail("ZAYIF_24H", `24h cok dusuk (${change24h.toFixed(2)}%) pump adayi degil`);
  }

  return pass("PUMP_ENTRY_OK", "pump-entry-safe");
}

export function formatPumpEntrySafetyReason(result: PumpEntrySafetyResult) {
  return result.ok ? result.reason : result.reason;
}
