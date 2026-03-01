/*
  Warnings:

  - You are about to drop the column `accomplishments` on the `LogEntry` table. All the data in the column will be lost.
  - You are about to drop the column `hoursRendered` on the `LogEntry` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Trainee` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[email]` on the table `Trainee` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `hoursWorked` to the `LogEntry` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lunchEnd` to the `LogEntry` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lunchStart` to the `LogEntry` table without a default value. This is not possible if the table is not empty.
  - Added the required column `companyName` to the `Trainee` table without a default value. This is not possible if the table is not empty.
  - Added the required column `contactNumber` to the `Trainee` table without a default value. This is not possible if the table is not empty.
  - Added the required column `email` to the `Trainee` table without a default value. This is not possible if the table is not empty.
  - Added the required column `firstName` to the `Trainee` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lastName` to the `Trainee` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "LogEntry" DROP COLUMN "accomplishments",
DROP COLUMN "hoursRendered",
ADD COLUMN     "hoursWorked" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "lunchEnd" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "lunchStart" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "remarks" TEXT;

-- AlterTable
ALTER TABLE "Trainee" DROP COLUMN "name",
ADD COLUMN     "companyName" TEXT NOT NULL,
ADD COLUMN     "contactNumber" TEXT NOT NULL,
ADD COLUMN     "email" TEXT NOT NULL,
ADD COLUMN     "firstName" TEXT NOT NULL,
ADD COLUMN     "lastName" TEXT NOT NULL,
ADD COLUMN     "middleName" TEXT,
ADD COLUMN     "suffix" TEXT;

-- CreateTable
CREATE TABLE "Supervisor" (
    "id" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "suffix" TEXT,
    "contactNumber" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supervisor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supervisor_traineeId_idx" ON "Supervisor"("traineeId");

-- CreateIndex
CREATE UNIQUE INDEX "Trainee_email_key" ON "Trainee"("email");

-- AddForeignKey
ALTER TABLE "Supervisor" ADD CONSTRAINT "Supervisor_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "Trainee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
