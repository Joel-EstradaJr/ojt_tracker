/*
  Warnings:

  - You are about to drop the column `remarks` on the `LogEntry` table. All the data in the column will be lost.
  - Added the required column `accomplishment` to the `LogEntry` table without a default value. This is not possible if the table is not empty.

*/
-- Rename remarks -> accomplishment and make it required
ALTER TABLE "LogEntry" RENAME COLUMN "remarks" TO "accomplishment";
ALTER TABLE "LogEntry" ALTER COLUMN "accomplishment" SET DEFAULT '';
ALTER TABLE "LogEntry" ALTER COLUMN "accomplishment" SET NOT NULL;
ALTER TABLE "LogEntry" ALTER COLUMN "accomplishment" DROP DEFAULT;
