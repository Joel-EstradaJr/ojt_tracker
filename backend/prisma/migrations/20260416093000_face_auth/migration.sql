ALTER TABLE "User"
  ADD COLUMN "faceEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "faceAttendanceEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "faceEmbedding" JSONB,
  ADD COLUMN "faceEnrolledAt" TIMESTAMP(3);

ALTER TABLE "LogEntry"
  ADD COLUMN "faceVerified" BOOLEAN NOT NULL DEFAULT false;
