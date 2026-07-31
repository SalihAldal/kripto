import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createEngineeringAudit, persistApiFinding } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { emitEngineeringEvent, ENGINEERING_EVENT } from "@/src/server/engineering-intelligence/engineering-intelligence.events";

const ROOT = process.cwd();

function findRoutes(dir: string, prefix = "", depth = 0): string[] {
  if (depth > 10 || !existsSync(dir)) return [];
  const routes: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        routes.push(...findRoutes(full, `${prefix}/${entry}`, depth + 1));
      } else if (entry === "route.ts") {
        routes.push(`${prefix}`);
      }
    }
  } catch { /* skip */ }
  return routes;
}

export async function auditApis(limit = 100) {
  const audit = await createEngineeringAudit({
    auditType: "API_SCAN",
    category: "API",
    summary: "API surface and consistency audit",
  });

  const apiDir = join(ROOT, "app/api");
  const routes = findRoutes(apiDir, "/api");
  let findings = 0;
  const seen = new Map<string, number>();

  for (const route of routes.slice(0, limit)) {
    const routeFile = join(ROOT, "app", route.replace(/^\/api\//, "api/"), "route.ts");
    let hasAuth = false;
    let methods: string[] = [];
    try {
      const content = readFileSync(routeFile, "utf-8");
      hasAuth = content.includes("secureRoute");
      if (content.includes("export async function GET")) methods.push("GET");
      if (content.includes("export async function POST")) methods.push("POST");
      if (content.includes("export async function PUT")) methods.push("PUT");
      if (content.includes("export async function DELETE")) methods.push("DELETE");
      if (content.includes("export async function PATCH")) methods.push("PATCH");
    } catch { continue; }

    const base = route.replace(/\/[^/]+$/, "");
    seen.set(base, (seen.get(base) ?? 0) + 1);

    const severity = !hasAuth && route.includes("trading-core") ? "HIGH" as const : "INFO" as const;
    const status = !hasAuth && route.includes("trading-core") ? "WARNING" as const : "PASSED" as const;

    await persistApiFinding(audit.id, {
      routePath: route,
      method: methods.join(","),
      status,
      severity,
      hasAuth,
      finding: !hasAuth && route.includes("trading-core") ? "Trading API route missing secureRoute" : `${methods.join(",")} handlers`,
    });
    if (status !== "PASSED") findings += 1;
  }

  const duplicates = [...seen.entries()].filter(([, c]) => c > 5);
  for (const [path, count] of duplicates) {
    await persistApiFinding(audit.id, {
      routePath: path, status: "WARNING", severity: "LOW",
      finding: `Route group ${path} has ${count} endpoints — verify REST consistency`,
    });
    findings += 1;
  }

  emitEngineeringEvent(ENGINEERING_EVENT.AUDIT_COMPLETED, { auditId: audit.id, findings, totalRoutes: routes.length });
  return { auditId: audit.id, findings, totalRoutes: routes.length };
}
