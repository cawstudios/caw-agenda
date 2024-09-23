BEGIN;

CREATE SCHEMA IF NOT EXISTS "${schema}";

CREATE TABLE IF NOT EXISTS "${schema}"."${tableName}" (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  data JSONB,
  type TEXT,
  priority INTEGER DEFAULT 0,
  "nextRunAt" TIMESTAMP WITH TIME ZONE,
  "lastRunAt" TIMESTAMP WITH TIME ZONE,
  "lastFinishedAt" TIMESTAMP WITH TIME ZONE,
  "lockedAt" TIMESTAMP WITH TIME ZONE,
  disabled BOOLEAN DEFAULT false,
  progress INTEGER,
  "failReason" TEXT,
  "failCount" INTEGER DEFAULT 0,
  "failedAt" TIMESTAMP WITH TIME ZONE,
  "lastModifiedBy" TEXT,
  "fork" BOOLEAN DEFAULT false,
  "repeatInterval" TEXT,
  "repeatAt" TIMESTAMP WITH TIME ZONE,
  "repeatTimezone" TEXT,
  "unique" JSONB,
  "uniqueOpts" JSONB
);

CREATE INDEX IF NOT EXISTS idx_${tableName}_find_and_lock 
ON "${schema}"."${tableName}" (name, "nextRunAt", "lockedAt", disabled);

CREATE TABLE IF NOT EXISTS "${schema}"."${tableName}ExecutionLog" (
    id SERIAL PRIMARY KEY,
    "jobId" UUID REFERENCES "${schema}"."${tableName}"(id) ON DELETE CASCADE,
    "runAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "finishedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "result" VARCHAR(10) NOT NULL CHECK (result IN ('success', 'fail')),
    "error" TEXT
);

CREATE INDEX IF NOT EXISTS idx_${tableName}_execution_log_jobId ON "${schema}"."${tableName}ExecutionLog"("jobId");

COMMIT;