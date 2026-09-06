-- FIX02: durable PR04 exit snapshot/state persistence
CREATE TABLE "PositionExitPersistedState" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "selectedSignal" JSONB,
    "snapshot" JSONB NOT NULL,
    "state" JSONB NOT NULL,
    "stateVersion" INTEGER NOT NULL DEFAULT 1,
    "terminalStatus" TEXT NOT NULL,
    "processedFillIds" JSONB NOT NULL DEFAULT '[]',
    "activeExitIntentId" TEXT,
    "reconciliationStatus" TEXT NOT NULL DEFAULT 'OK',
    "ownerExecutionId" TEXT,
    "ownerFenceToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PositionExitPersistedState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PositionExitPersistedState_positionId_key" ON "PositionExitPersistedState"("positionId");
CREATE INDEX "PositionExitPersistedState_userId_terminalStatus_idx" ON "PositionExitPersistedState"("userId", "terminalStatus");
CREATE INDEX "PositionExitPersistedState_ownerExecutionId_idx" ON "PositionExitPersistedState"("ownerExecutionId");

ALTER TABLE "PositionExitPersistedState" ADD CONSTRAINT "PositionExitPersistedState_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;
