ALTER TABLE "User"
  ADD COLUMN "pendingEmailVerifyAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pendingEmailAdminResendRequired" BOOLEAN NOT NULL DEFAULT false;
