import { newDb, IMemoryDb } from 'pg-mem';
import { Pool } from 'pg';
import debug from 'debug';

const log = debug('agenda:mock-postgres');
const schema = 'agendaJobs';
const tableName = 'CronJobs';
const uri = 'postgresql://postgres:root@localhost:5432/celito-local';

export interface IMockPostgres {
    disconnect: () => void;
    pool: Pool;
    db: IMemoryDb;
    uri: string;
}

export async function mockPostgres(): Promise<IMockPostgres> {
    const self: IMockPostgres = {} as any;
    self.db = newDb();
    
    log('pg-mem instance created');

    self.pool = new Pool({ connectionString: uri });
    await self.pool.connect();

    await setupTables(self.pool);

    self.disconnect = function () {
        self.pool.end();
        log('pg-mem instance stopped');
    };
    self.uri = uri;

    return self;
}

export async function setupTables(pool: Pool) {
  const client = await pool.connect();

  try {
    const schemaSQL = `BEGIN;
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

      CREATE TABLE IF NOT EXISTS "${schema}"."${tableName}RunHistory" (
          id SERIAL PRIMARY KEY,
          job_id UUID REFERENCES "${schema}"."${tableName}"(id) ON DELETE CASCADE,
          run_at TIMESTAMP WITH TIME ZONE NOT NULL,
          finished_at TIMESTAMP WITH TIME ZONE NOT NULL,
          result VARCHAR(10) NOT NULL CHECK (result IN ('success', 'fail')),
          error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_${tableName}_run_history_job_id ON "${schema}"."${tableName}RunHistory"(job_id);

      COMMIT;`;

    await client.query(schemaSQL);
  } finally {
    client.release();
  }
}


