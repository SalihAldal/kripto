import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
export const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
export function atomicJson(file: string, value: unknown) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
}
export function sourceFingerprint() {
    const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "src/server", "scripts", "package.json", "package-lock.json"], { encoding: "utf8" }).split("\0").filter(Boolean);
    return sha([...new Set(files)].sort().map(f => `${f}:${fs.existsSync(f) ? sha(fs.readFileSync(f)) : "deleted"}`).join("\n"));
}
export function verifyDataset(root: string) {
    const checks = fs.readFileSync(path.join(root, "checksums.sha256"), "utf8");
    const listed = new Set<string>();
    for (const line of checks.trim().split(/\r?\n/)) {
        const match = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line);
        if (!match)
            throw new Error("INVALID_CHECKSUM_LINE");
        const relative = match[2].replace(/\\/g, "/");
        const file = path.resolve(root, relative);
        if (!file.startsWith(path.resolve(root) + path.sep))
            throw new Error("DATASET_PATH_OUTSIDE_ROOT");
        if (sha(fs.readFileSync(file)) !== match[1])
            throw new Error(`DATASET_CHECKSUM_MISMATCH:${relative}`);
        listed.add(relative);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
    if (!listed.has("manifest.json") || !listed.has("asset-mapping.json"))
        throw new Error("UNCHECKED_DATASET_METADATA");
    for (const symbol of manifest.symbols ?? []) {
        const name = `deep-oi-data/${symbol}.json`;
        if (!listed.has(name))
            throw new Error(`UNCHECKED_SYMBOL:${symbol}`);
        const panel = JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
        const execution = panel.files?.executionBarsTRY;
        if (typeof execution !== "string" || !listed.has(execution.replace(/\\/g, "/")))
            throw new Error(`UNCHECKED_EXECUTION:${symbol}`);
    }
    return { hash: sha(checks), manifest, files: listed.size };
}
