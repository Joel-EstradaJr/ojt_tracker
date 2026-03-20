import { UserRole } from "@prisma/client";
import prisma from "../utils/prisma";

type Issue = {
  check: string;
  count: number;
  detail?: string;
};

function printIssues(issues: Issue[]) {
  if (issues.length === 0) {
    console.log("Validation passed: no issues found.");
    return;
  }

  console.error("Validation failed with issues:");
  for (const issue of issues) {
    console.error(`- ${issue.check}: ${issue.count}${issue.detail ? ` (${issue.detail})` : ""}`);
  }
}

async function validateNormalizedData() {
  const issues: Issue[] = [];

  const requiredTables = ["User", "UserProfile", "Company", "WorkScheduleEntry", "OvertimeLedger", "PasswordResetCode", "PasswordHistory", "LogEntry"];
  const tableChecks = await Promise.all(
    requiredTables.map((tableName) =>
      prisma.$queryRaw<Array<{ exists: string | null }>>`
        SELECT to_regclass(${`public."${tableName}"`})::text AS exists
      `
    )
  );

  const missingTables = requiredTables.filter((_, idx) => !tableChecks[idx][0]?.exists);
  if (missingTables.length > 0) {
    console.error("Validation skipped: normalized schema tables are not fully deployed.");
    console.error(`Missing tables: ${missingTables.join(", ")}`);
    console.error("Run prisma migrations first (e.g. npm run prisma:deploy), then rerun this validator.");
    process.exitCode = 1;
    return;
  }

  const traineeWithoutUserRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "UserProfile" t
    LEFT JOIN "User" u ON u.id = t."userId"
    WHERE u.id IS NULL
  `;
  const traineeWithoutUser = Number(traineeWithoutUserRows[0]?.count ?? 0n);
  if (traineeWithoutUser > 0) {
    issues.push({ check: "Trainees missing User relation", count: traineeWithoutUser });
  }

  const traineeWithoutCompanyRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "UserProfile" t
    LEFT JOIN "Company" c ON c.id = t."companyId"
    WHERE c.id IS NULL
  `;
  const traineeWithoutCompany = Number(traineeWithoutCompanyRows[0]?.count ?? 0n);
  if (traineeWithoutCompany > 0) {
    issues.push({ check: "Trainees missing Company relation", count: traineeWithoutCompany });
  }

  const traineeRoleUsersWithoutProfile = await prisma.user.count({
    where: {
      role: UserRole.TRAINEE,
      trainee: { is: null },
    },
  });
  if (traineeRoleUsersWithoutProfile > 0) {
    issues.push({ check: "TRAINEE users missing Trainee profile", count: traineeRoleUsersWithoutProfile });
  }

  const resetCodeOrphansRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "PasswordResetCode" prc
    LEFT JOIN "User" u ON u.id = prc."userId"
    WHERE u.id IS NULL
  `;
  const resetCodeOrphans = Number(resetCodeOrphansRows[0]?.count ?? 0n);
  if (resetCodeOrphans > 0) {
    issues.push({ check: "PasswordResetCode orphans", count: resetCodeOrphans });
  }

  const passwordHistoryOrphansRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "PasswordHistory" ph
    LEFT JOIN "User" u ON u.id = ph."userId"
    WHERE u.id IS NULL
  `;
  const passwordHistoryOrphans = Number(passwordHistoryOrphansRows[0]?.count ?? 0n);
  if (passwordHistoryOrphans > 0) {
    issues.push({ check: "PasswordHistory orphans", count: passwordHistoryOrphans });
  }

  const logsByTrainee = await prisma.logEntry.groupBy({
    by: ["traineeId"],
    _sum: {
      overtime: true,
      offsetUsed: true,
    },
  });

  const ledgerByTrainee = await prisma.overtimeLedger.groupBy({
    by: ["traineeId", "type"],
    _sum: { hours: true },
  });

  const ledgerMap = new Map<string, { earned: number; used: number; adjusted: number }>();
  for (const row of ledgerByTrainee) {
    const current = ledgerMap.get(row.traineeId) || { earned: 0, used: 0, adjusted: 0 };
    if (row.type === "EARNED") current.earned = row._sum.hours || 0;
    if (row.type === "USED") current.used = row._sum.hours || 0;
    if (row.type === "ADJUSTED") current.adjusted = row._sum.hours || 0;
    ledgerMap.set(row.traineeId, current);
  }

  let mismatchedBalances = 0;
  for (const row of logsByTrainee) {
    const expected = (row._sum.overtime || 0) - (row._sum.offsetUsed || 0);
    const ledger = ledgerMap.get(row.traineeId) || { earned: 0, used: 0, adjusted: 0 };
    const actual = ledger.earned + ledger.adjusted - ledger.used;
    if (Math.abs(expected - actual) > 0.0001) {
      mismatchedBalances += 1;
    }
  }

  if (mismatchedBalances > 0) {
    issues.push({
      check: "Trainees with ledger/log overtime mismatch",
      count: mismatchedBalances,
      detail: "Expected (sum log overtime - sum log offsetUsed) to equal (earned + adjusted - used)",
    });
  }

  printIssues(issues);

  if (issues.length > 0) {
    process.exitCode = 1;
  }
}

validateNormalizedData()
  .catch((error) => {
    console.error("Validation script failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
