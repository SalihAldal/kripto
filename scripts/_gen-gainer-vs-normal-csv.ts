import fs from "node:fs";
import path from "node:path";

const j = JSON.parse(fs.readFileSync(path.join(process.cwd(), "kripto-global-missed-opportunity-forensic.json"), "utf8"));
const traces = j.traces as Array<Record<string, unknown>>;
const rows = [["symbol", "group", "classification", "discovered", "firstBlocker", "discoveredBeforeMove"]];
for (let i = 0; i < traces.length; i++) {
  const t = traces[i];
  rows.push([
    String(t.symbol),
    i < 10 ? "TOP10_GAINER" : "TOP11_50",
    String(t.classification),
    String(t.discovered),
    String(t.firstBlocker).slice(0, 120),
    String(t.discoveredBeforeMove),
  ]);
}
const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n") + "\n";
fs.writeFileSync(path.join(process.cwd(), "kripto-gainer-vs-normal-candidates.csv"), csv);
console.log("ok", rows.length);
