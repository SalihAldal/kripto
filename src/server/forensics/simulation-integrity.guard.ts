import type { ForensicStage, SimulationIntegrityReport } from "@/src/server/forensics/forensic.types";

type IntegrityClock = {
  decisionTimestamp: number;
  maxAllowedTimestamp: number;
  stage: ForensicStage;
  field: string;
  actualTimestamp: number;
};

const activeChecks: IntegrityClock[] = [];

export function beginSimulationIntegrityGuard(input: {
  sessionId: string;
  decisionTimestamp: number;
  stage: ForensicStage;
}) {
  return {
    assertDataTimestamp(field: string, actualTimestamp: number) {
      if (actualTimestamp > input.decisionTimestamp) {
        activeChecks.push({
          decisionTimestamp: input.decisionTimestamp,
          maxAllowedTimestamp: input.decisionTimestamp,
          stage: input.stage,
          field,
          actualTimestamp,
        });
        throw new SimulationIntegrityViolation({
          code: "LOOKAHEAD_DATA",
          message: `${field} timestamp ${actualTimestamp} exceeds decision timestamp ${input.decisionTimestamp}`,
          stage: input.stage,
          decisionTimestamp: new Date(input.decisionTimestamp).toISOString(),
          leakedTimestamp: new Date(actualTimestamp).toISOString(),
        });
      }
    },
  };
}

export class SimulationIntegrityViolation extends Error {
  code: string;
  stage: ForensicStage;
  decisionTimestamp: string;
  leakedTimestamp?: string;

  constructor(input: {
    code: string;
    message: string;
    stage: ForensicStage;
    decisionTimestamp: string;
    leakedTimestamp?: string;
  }) {
    super(input.message);
    this.name = "SimulationIntegrityViolation";
    this.code = input.code;
    this.stage = input.stage;
    this.decisionTimestamp = input.decisionTimestamp;
    this.leakedTimestamp = input.leakedTimestamp;
  }
}

export function buildSimulationIntegrityReport(sessionId: string): SimulationIntegrityReport {
  return {
    sessionId,
    checkedAt: new Date().toISOString(),
    violations: activeChecks.map((row) => ({
      code: "LOOKAHEAD_DATA",
      message: `${row.field} at ${row.actualTimestamp} > decision ${row.decisionTimestamp}`,
      stage: row.stage,
      decisionTimestamp: new Date(row.decisionTimestamp).toISOString(),
      leakedTimestamp: new Date(row.actualTimestamp).toISOString(),
    })),
    passed: activeChecks.length === 0,
  };
}

export function resetSimulationIntegrityChecks() {
  activeChecks.length = 0;
}

export function filterCandlesUpToTimestamp<T extends { timestamp: number }>(rows: T[], decisionTimestamp: number) {
  return rows.filter((row) => row.timestamp <= decisionTimestamp);
}
