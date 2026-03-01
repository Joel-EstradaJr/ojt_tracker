/*
  Warnings:

  - A unique constraint covering the columns `[traineeId,date]` on the table `LogEntry` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "LogEntry_traineeId_date_key" ON "LogEntry"("traineeId", "date");
