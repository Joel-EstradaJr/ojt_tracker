-- Case-insensitive unique constraint on trainee full name.
-- Uses LOWER() and COALESCE() so that NULL middle-name / suffix
-- are treated as empty strings (avoiding PostgreSQL NULL != NULL).
CREATE UNIQUE INDEX "Trainee_name_ci_unique"
  ON "Trainee" (
    LOWER("lastName"),
    LOWER("firstName"),
    LOWER(COALESCE("middleName", '')),
    LOWER(COALESCE("suffix", ''))
  );