-- Rename core profile table from Trainee to UserProfile
ALTER TABLE "Trainee" RENAME TO "UserProfile";

-- Keep common index names aligned with the new table name
ALTER INDEX "Trainee_userId_key" RENAME TO "UserProfile_userId_key";
ALTER INDEX "Trainee_companyId_idx" RENAME TO "UserProfile_companyId_idx";
