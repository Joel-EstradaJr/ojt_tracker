/*
  Warnings:

  - A unique constraint covering the columns `[traineeId,firstName,lastName,middleName,suffix]` on the table `Supervisor` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Supervisor_traineeId_firstName_lastName_middleName_suffix_key" ON "Supervisor"("traineeId", "firstName", "lastName", "middleName", "suffix");
