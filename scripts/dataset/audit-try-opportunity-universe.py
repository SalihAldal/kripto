"""Public, read-only coverage audit. Current TR listings are NOT a point-in-time universe.
Daily highs are descriptive opportunity labels, never fills or a profitability test.
Run from repository root: python scripts/dataset/audit-try-opportunity-universe.py
"""
import concurrent.futures
import datetime as dt
import gzip
import hashlib
import json
import pathlib
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path("artifacts/try-universe-audit")
END = int(dt.datetime(2026, 9, 1, tzinfo=dt.timezone.utc).timestamp() * 1000) - 1
START = END + 1 - 270 * 86400000
SYMBOLS_URL = "https://www.binance.tr/open/v1/common/symbols"
KLINES_URL = "https://api.binance.me/api/v3/klines"


def atomic(name, data):
    target = ROOT / name
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(target)


def get(url):
    for attempt in range(2):
        try:
            with urllib.request.urlopen(url, timeout=20) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            # Stop retrying a rate-limited endpoint; expose the failure in the audit.
            if exc.code in (418, 429) or attempt == 1:
                raise
        except (TimeoutError, urllib.error.URLError):
            if attempt == 1:
                raise
        time.sleep(1)


def collect(asset):
    symbol = asset["symbol"].replace("_", "")
    url = f"{KLINES_URL}?symbol={symbol}&interval=1d&startTime={START}&endTime={END}&limit=300"
    try:
        rows = get(url)
        if not isinstance(rows, list):
            raise ValueError("KLINES_NOT_ARRAY")
        days, seen = [], set()
        for row in rows:
            t, close_t = int(row[0]), int(row[6])
            if t < START or close_t > END:
                continue
            o, h, low, c, v, q = map(float, [row[1], row[2], row[3], row[4], row[5], row[7]])
            if t in seen or t % 86400000 or close_t != t + 86400000 - 1 or not (0 < low <= min(o, c) <= max(o, c) <= h) or v < 0 or q < 0:
                raise ValueError("INVALID_DAILY_BAR")
            seen.add(t)
            if v > 0 and q > 0:
                days.append({"at": t, "closePct": (c/o-1)*100, "highPct": (h/o-1)*100, "quoteVolumeTry": q})
        payload = json.dumps(rows, separators=(",", ":")).encode()
        (ROOT / f"{symbol}-1d.json.gz").write_bytes(gzip.compress(payload, mtime=0))
        return {"symbol": symbol, "status": "FETCHED", "url": url, "rawSha256": hashlib.sha256(payload).hexdigest(),
                "activeDays": len(days), "missingOrInactiveDays": 270-len(days), "days": days}
    except Exception as exc:
        return {"symbol": symbol, "status": "FAILED", "url": url, "error": str(exc)}


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    atomic("result.json", {"status": "RUNNING"})
    symbols = get(SYMBOLS_URL)
    if symbols.get("code") != 0 or not isinstance(symbols.get("data", {}).get("list"), list):
        raise ValueError("TR_SYMBOL_DISCOVERY_FAILED")
    atomic("symbols.json", symbols)
    assets = sorted((x for x in symbols["data"]["list"] if x.get("quoteAsset") == "TRY" and x.get("type") == 1), key=lambda x: x["symbol"])
    if not assets:
        raise ValueError("EMPTY_TR_UNIVERSE")
    print(f"DISCOVERED {len(assets)} supported TRY type-1 pairs", flush=True)
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for result in pool.map(collect, assets):
            results.append(result)
            if len(results) % 25 == 0:
                print(f"FETCHED {len(results)}/{len(assets)} failures={sum(x['status']=='FAILED' for x in results)}", flush=True)
                atomic("result.json", {"status": "RUNNING", "results": results})
    summary = []
    for length in [30, 60, 90, 270]:
        days = [d for r in results for d in r.get("days", []) if d["at"] >= END + 1 - length*86400000]
        summary.append({"days": length, "coinDays": len(days), "thresholds": [{"pct": pct, "closeCount": sum(d["closePct"] >= pct for d in days), "highCount": sum(d["highPct"] >= pct for d in days)} for pct in [5,10,20,30]]})
    atomic("result.json", {"status": "COMPLETED_WITH_GAPS" if any(x["status"] == "FAILED" for x in results) else "COMPLETED",
          "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "start": START, "end": END,
          "symbolSource": SYMBOLS_URL, "currentSupportedPairs": len(assets), "summary": summary, "results": results,
          "limitations": ["CURRENT_LISTINGS_SURVIVORSHIP_BIAS", "HISTORICAL_TR_LISTING_DATES_NOT_VERIFIED", "DAILY_HIGH_NOT_EXECUTABLE_FILL", "TYPE_2_3_UNSUPPORTED", "NOT_PROFITABILITY_EVIDENCE"]})
    print(json.dumps(summary), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        ROOT.mkdir(parents=True, exist_ok=True)
        atomic("result.json", {"status": "ERROR", "error": str(error)})
        raise
