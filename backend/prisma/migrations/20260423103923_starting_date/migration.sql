/*
  Warnings:

  - Added the required column `startingDate` to the `UserProfile` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "startingDate" TIMESTAMP(3) NOT NULL;
