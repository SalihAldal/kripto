import { prisma } from "@/src/server/db/prisma";
import { createConfigurationVersion } from "@/src/server/ai-governance/ai-governance.repository";
import type { ConfigDomain } from "@prisma/client";

export async function versionConfiguration(input: {
  configKey: string;
  domain: ConfigDomain;
  config: Record<string, unknown>;
  bump?: "patch" | "minor" | "major";
  environment?: string;
  tenantId?: string;
  exchange?: string;
  accountId?: string;
  actor?: string;
  activate?: boolean;
}) {
  const latest = await prisma.configurationVersion.findFirst({
    where: { configKey: input.configKey, environment: input.environment ?? "production" },
    orderBy: [{ semverMajor: "desc" }, { semverMinor: "desc" }, { semverPatch: "desc" }],
  });

  let major = latest?.semverMajor ?? 1;
  let minor = latest?.semverMinor ?? 0;
  let patch = latest?.semverPatch ?? 0;
  const bump = input.bump ?? "patch";
  if (bump === "patch") patch += 1;
  if (bump === "minor") { minor += 1; patch = 0; }
  if (bump === "major") { major += 1; minor = 0; patch = 0; }

  const versionTag = `${major}.${minor}.${patch}`;
  const row = await createConfigurationVersion({
    configKey: input.configKey,
    domain: input.domain,
    versionTag,
    config: input.config,
    environment: input.environment,
    tenantId: input.tenantId,
    exchange: input.exchange,
    accountId: input.accountId,
    actor: input.actor,
  });

  if (input.activate) {
    await prisma.configurationVersion.updateMany({
      where: { configKey: input.configKey, environment: input.environment ?? "production", active: true },
      data: { active: false },
    });
    await prisma.configurationVersion.update({ where: { id: row.id }, data: { active: true } });
  }

  return row;
}

export async function getActiveConfiguration(configKey: string, environment = "production") {
  return prisma.configurationVersion.findFirst({
    where: { configKey, environment, active: true },
    orderBy: { updatedAt: "desc" },
  });
}

export async function listConfigurationVersions(configKey: string, environment = "production") {
  return prisma.configurationVersion.findMany({
    where: { configKey, environment },
    orderBy: { createdAt: "desc" },
  });
}

export async function validateConfiguration(config: Record<string, unknown>) {
  const errors: string[] = [];
  if (Object.keys(config).length === 0) errors.push("Empty configuration");
  for (const [key, value] of Object.entries(config)) {
    if (key.includes("threshold") && typeof value === "number" && (value < 0 || value > 100)) {
      errors.push(`Invalid threshold: ${key}=${value}`);
    }
    if (key.includes("weight") && typeof value === "number" && (value < 0 || value > 1)) {
      errors.push(`Invalid weight: ${key}=${value}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
