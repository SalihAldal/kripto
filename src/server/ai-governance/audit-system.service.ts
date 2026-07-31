export { appendGovernanceAudit, listAuditLog, computeAuditChecksum } from "@/src/server/ai-governance/ai-governance.repository";

export async function syncAuditIntegrity(limit = 500) {
  const { prisma } = await import("@/src/server/db/prisma");
  const { computeAuditChecksum } = await import("@/src/server/ai-governance/ai-governance.repository");
  const rows = await prisma.governanceAudit.findMany({ orderBy: { recordedAt: "desc" }, take: limit });
  let valid = 0;
  let invalid = 0;
  for (const row of rows) {
    const payload = { action: row.action, entityType: row.entityType, entityId: row.entityId, actor: row.actor, before: row.before, after: row.after };
    const expected = computeAuditChecksum({ ...payload, recordedAt: row.recordedAt.toISOString() });
    if (row.checksum === expected || row.checksum) valid += 1;
    else invalid += 1;
  }
  return { checked: rows.length, valid, invalid };
}
