import { OvertimeType } from "@prisma/client";
import prisma from "../utils/prisma";

async function syncOvertimeLedger() {
  const dryRun = process.argv.includes("--dry-run");

  const requiredTables = ["LogEntry", "OvertimeLedger"];
  const checks = await Promise.all(
    requiredTables.map((tableName) =>
      prisma.$queryRaw<Array<{ exists: string | null }>>`
        SELECT to_regclass(${`public."${tableName}"`})::text AS exists
      `
    )
  );

  const missingTables = requiredTables.filter((_, idx) => !checks[idx][0]?.exists);
  if (missingTables.length > 0) {
    console.error("Overtime ledger sync aborted: required tables are missing.");
    console.error(`Missing tables: ${missingTables.join(", ")}`);
    console.error("Run schema migrations first, then rerun this script.");
    process.exitCode = 1;
    return;
  }

  const logs = await prisma.logEntry.findMany({
    select: { id: true, traineeId: true, overtime: true, offsetUsed: true },
  });

  let createdOrUpdated = 0;
  let deleted = 0;

  for (const log of logs) {
    if (log.overtime > 0) {
      if (!dryRun) {
        await prisma.overtimeLedger.upsert({
          where: {
            sourceLogId_type: {
              sourceLogId: log.id,
              type: OvertimeType.EARNED,
            },
          },
          create: {
            traineeId: log.traineeId,
            sourceLogId: log.id,
            type: OvertimeType.EARNED,
            hours: log.overtime,
            notes: "Backfilled from LogEntry.overtime",
          },
          update: {
            hours: log.overtime,
          },
        });
      }
      createdOrUpdated += 1;
    } else {
      if (!dryRun) {
        const result = await prisma.overtimeLedger.deleteMany({
          where: {
            sourceLogId: log.id,
            type: OvertimeType.EARNED,
          },
        });
        deleted += result.count;
      }
    }

    if (log.offsetUsed > 0) {
      if (!dryRun) {
        await prisma.overtimeLedger.upsert({
          where: {
            sourceLogId_type: {
              sourceLogId: log.id,
              type: OvertimeType.USED,
            },
          },
          create: {
            traineeId: log.traineeId,
            sourceLogId: log.id,
            type: OvertimeType.USED,
            hours: log.offsetUsed,
            notes: "Backfilled from LogEntry.offsetUsed",
          },
          update: {
            hours: log.offsetUsed,
          },
        });
      }
      createdOrUpdated += 1;
    } else {
      if (!dryRun) {
        const result = await prisma.overtimeLedger.deleteMany({
          where: {
            sourceLogId: log.id,
            type: OvertimeType.USED,
          },
        });
        deleted += result.count;
      }
    }
  }

  if (!dryRun) {
    const cleanup = await prisma.overtimeLedger.deleteMany({
      where: {
        sourceLogId: { not: null },
        type: { in: [OvertimeType.EARNED, OvertimeType.USED] },
        sourceLog: { is: null },
      },
    });
    deleted += cleanup.count;
  }

  console.log("Overtime ledger sync complete");
  console.log(`Mode: ${dryRun ? "dry-run" : "write"}`);
  console.log(`Logs scanned: ${logs.length}`);
  console.log(`Ledger rows created/updated: ${createdOrUpdated}`);
  console.log(`Ledger rows deleted: ${deleted}`);
}

syncOvertimeLedger()
  .catch((error) => {
    console.error("Overtime ledger sync failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
