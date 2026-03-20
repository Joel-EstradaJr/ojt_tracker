/*
  Warnings:

  - You are about to drop the column `workDays` on the `Trainee` table. All the data in the column will be lost.
  - You are about to drop the column `workEndTime` on the `Trainee` table. All the data in the column will be lost.
  - You are about to drop the column `workStartTime` on the `Trainee` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Trainee" DROP COLUMN "workDays",
DROP COLUMN "workEndTime",
DROP COLUMN "workStartTime",
ADD COLUMN     "workSchedule" JSONB NOT NULL DEFAULT '{"1":{"start":"08:00","end":"17:00"},"2":{"start":"08:00","end":"17:00"},"3":{"start":"08:00","end":"17:00"},"4":{"start":"08:00","end":"17:00"},"5":{"start":"08:00","end":"17:00"}}';
