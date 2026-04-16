# User/Trainee Normalization Migration Plan

## Goal
Migrate old schema data into normalized models (`User`, `Company`, `WorkScheduleEntry`, `OvertimeLedger`) with no data loss and referential integrity.

## Preconditions
1. Create a full database backup before running any migration.
2. Stop background workers and disable write traffic during cutover window.
3. Deploy code compatible with BOTH old and new data only if doing rolling migration.
4. Run Prisma migrations first: `npm run prisma:deploy`.

## Safe Cutover Sequence
1. Backup:
   - Use `pg_dump` (or managed backup snapshot) before mutation scripts.
2. Validate schema:
   - Confirm tables exist: `User`, `Trainee`, `Company`, `WorkScheduleEntry`, `OvertimeLedger`.
3. Migrate users from old trainee auth fields:
   - For each old trainee record, create a `User` row.
   - Map role string to enum: `admin -> ADMIN`, everything else -> `TRAINEE`.
4. Migrate profile to new trainee:
   - Set `Trainee.userId` to newly created user id.
   - Resolve `companyName` into `Company` via upsert.
5. Migrate work schedules:
   - Parse JSON schedule safely.
   - Insert one `WorkScheduleEntry` per valid day key (`0-6`).
   - If invalid/malformed, fall back to default Mon-Fri 08:00-17:00.
6. Migrate password reset/history/audit relations:
   - Rewrite FK references from old trainee id to mapped user id.
7. Seed overtime ledger from logs:
   - Create `EARNED` ledger entries for `LogEntry.overtime > 0`.
   - Create `USED` ledger entries for `LogEntry.offsetUsed > 0`.
8. Verify counts and balances (see validation section).
9. Re-enable writes and monitor logs.

## Field Mapping
- Old `Trainee.email` -> `User.email`
- Old `Trainee.role` -> `User.role`
- Old `Trainee.passwordHash` -> `User.passwordHash`
- Old `Trainee.mustChangePassword` -> `User.mustChangePassword`
- Old `Trainee.failedLoginAttempts` -> `User.failedLoginAttempts`
- Old `Trainee.lockedUntil` -> `User.lockedUntil`
- Old `Trainee.companyName` -> `Company.name` + `Trainee.companyId`
- Old `Trainee.workSchedule` JSON -> `WorkScheduleEntry[]`
- Old `PasswordResetCode.traineeId` -> `PasswordResetCode.userId`
- Old `PasswordHistory.traineeId` -> `PasswordHistory.userId`
- Old `AuditLog.performedById` (trainee id) -> `AuditLog.performedById` (user id)

## Data Validation Checklist
1. Every `Trainee` has a non-null `userId` and existing `User`.
2. Every `Trainee.companyId` points to an existing `Company`.
3. `User.email` remains unique.
4. `PasswordResetCode.userId` and `PasswordHistory.userId` have no orphan rows.
5. For each trainee:
   - `sum(EARNED + ADJUSTED) - sum(USED)` equals expected offset bank.
6. Login works for both admin and trainee accounts.
7. Forgot-password and reset-password flows work end-to-end.

## Edge Cases
- Missing company name: map to `N/A` company.
- Malformed work schedule JSON: replace with default schedule.
- Duplicate company names with casing differences: normalize with trim + uppercase or case-insensitive unique policy.
- Existing duplicate trainee names: preserve records by id, but keep app-level duplicate prevention for new writes.

## Rollback
1. Keep pre-cutover backup until verification is complete.
2. If validation fails, restore backup and redeploy previous backend image.
3. Do not partially rerun scripts without truncating/rolling back migrated rows first.

## Post-Migration Monitoring
- Track failed logins and lockouts for spike anomalies.
- Track password reset error rates.
- Track log save/update error rates, especially overtime offset actions.
- Validate overtime ledger growth matches new log activity.

## Operational Commands
- Build backend:
   - `npm run build`
- One-command cutover (deploy + backfill + validate):
   - `npm run maintenance:cutover`
- Sync/backfill overtime ledger from existing logs:
   - Dry run: `npm run maintenance:sync-overtime-ledger:dry`
   - Apply changes: `npm run maintenance:sync-overtime-ledger`
- Validate normalized data integrity:
   - `npm run maintenance:validate-normalized`
