-- AlterTable
ALTER TABLE "UserProfile" RENAME CONSTRAINT "Trainee_pkey" TO "UserProfile_pkey";

-- RenameForeignKey
ALTER TABLE "UserProfile" RENAME CONSTRAINT "Trainee_companyId_fkey" TO "UserProfile_companyId_fkey";

-- RenameForeignKey
ALTER TABLE "UserProfile" RENAME CONSTRAINT "Trainee_userId_fkey" TO "UserProfile_userId_fkey";
