DROP INDEX IF EXISTS "daily_challenges_date_key";
CREATE INDEX IF NOT EXISTS "daily_challenges_date_idx" ON "daily_challenges"("date");