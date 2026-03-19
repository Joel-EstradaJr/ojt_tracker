ALTER TABLE "Trainee"
ADD COLUMN IF NOT EXISTS "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "PasswordHistory" (
  "id" TEXT NOT NULL,
  "traineeId" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PasswordHistory_traineeId_idx" ON "PasswordHistory"("traineeId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PasswordHistory_traineeId_fkey'
  ) THEN
    ALTER TABLE "PasswordHistory"
    ADD CONSTRAINT "PasswordHistory_traineeId_fkey"
    FOREIGN KEY ("traineeId") REFERENCES "Trainee"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
