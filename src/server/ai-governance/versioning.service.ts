import { prisma } from "@/src/server/db/prisma";
import { createModelVersion, appendGovernanceAudit } from "@/src/server/ai-governance/ai-governance.repository";
import type { VersionStage } from "@prisma/client";

export function buildVersionTag(major: number, minor: number, patch: number) {
  return `${major}.${minor}.${patch}`;
}

export async function bumpVersion(input: {
  registryId: string;
  bump: "patch" | "minor" | "major";
  stage?: VersionStage;
  changelog?: string;
  config?: Record<string, unknown>;
  actor?: string;
}) {
  const latest = await prisma.modelVersion.findFirst({
    where: { registryId: input.registryId },
    orderBy: [{ semverMajor: "desc" }, { semverMinor: "desc" }, { semverPatch: "desc" }],
  });
  let major = latest?.semverMajor ?? 1;
  let minor = latest?.semverMinor ?? 0;
  let patch = latest?.semverPatch ?? 0;
  if (input.bump === "patch") patch += 1;
  if (input.bump === "minor") { minor += 1; patch = 0; }
  if (input.bump === "major") { major += 1; minor = 0; patch = 0; }

  const version = await createModelVersion({
    registryId: input.registryId,
    versionTag: buildVersionTag(major, minor, patch),
    stage: input.stage ?? "EXPERIMENTAL",
    semverMajor: major,
    semverMinor: minor,
    semverPatch: patch,
    changelog: input.changelog,
    config: input.config,
    actor: input.actor,
  });
  return version;
}

export async function promoteVersionStage(versionId: string, stage: VersionStage, actor?: string) {
  const before = await prisma.modelVersion.findUnique({ where: { id: versionId } });
  const row = await prisma.modelVersion.update({ where: { id: versionId }, data: { stage } });
  if (stage === "PRODUCTION") {
    await prisma.modelVersion.updateMany({
      where: { registryId: row.registryId, id: { not: versionId }, stage: "PRODUCTION" },
      data: { stage: "DEPRECATED" },
    });
  }
  await appendGovernanceAudit({
    action: "VERSION_CREATE",
    entityType: "ModelVersion",
    entityId: versionId,
    actor,
    before: before ? { stage: before.stage } : undefined,
    after: { stage: row.stage },
  });
  return row;
}

export async function archiveVersion(versionId: string, actor?: string) {
  return promoteVersionStage(versionId, "ARCHIVED", actor);
}
