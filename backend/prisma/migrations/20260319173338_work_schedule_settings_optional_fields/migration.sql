-- AlterTable
ALTER TABLE "LogEntry" ALTER COLUMN "timeOut" DROP NOT NULL,
ALTER COLUMN "hoursWorked" SET DEFAULT 0,
ALTER COLUMN "accomplishment" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "countEarlyInAsOT" BOOLEAN NOT NULL DEFAULT false,
    "countLateOutAsOT" BOOLEAN NOT NULL DEFAULT false,
    "countEarlyLunchEndAsOT" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);
