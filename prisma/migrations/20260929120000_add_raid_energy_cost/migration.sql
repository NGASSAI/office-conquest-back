ALTER TABLE "raids" ADD COLUMN "energyCost" INTEGER NOT NULL DEFAULT 0;

UPDATE "raids" AS raid
SET "energyCost" = team."energyThreshold"
FROM "teams" AS team
WHERE raid."attackerTeamId" = team."id"
  AND raid."status" = 'PENDING';