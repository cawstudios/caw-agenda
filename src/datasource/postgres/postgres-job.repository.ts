import debug from 'debug';
import { ClientConfig, Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import type { Job, JobWithId } from '../../jobs/job';
import type { Agenda } from '../../index';
import type { IDatabaseOptions, IPostgresOptions } from '../interfaces/db-config.interface';
import type { IJobParameters } from '../../jobs/interfaces/job-parameters';
import { IJobRepository } from '../interfaces/job-repository.interface';
import { QueryCondition } from '../../types/query.type';
import { readFileSync } from 'fs';
import { join } from 'path';
import { JobExecutionLog } from '../../jobs/interfaces/job-execution-log';

const log = debug('agenda:db');

export class PostgresJobRepository implements IJobRepository {
  private pool: Pool;
  private schema: string;
  private tableName: string;
  private sortConfig: any;

  constructor(
    private agenda: Agenda,
    private connectOptions: IPostgresOptions & IDatabaseOptions
  ) {
    this.sortConfig = this.connectOptions?.sort || { nextRunAt: 1, priority: -1 };
    this.schema = this.connectOptions?.db?.schema || 'public';
    this.tableName = this.connectOptions?.db?.tableName || 'CronJob';
  }

  async connect(): Promise<void> {
    if(this.hasPostgresConnection(this.connectOptions)) {
      this.pool = this.connectOptions.postgres;
    } else if(this.hasDatabaseConfig(this.connectOptions)) {
      this.pool = new Pool((this.connectOptions as IPostgresOptions).db as ClientConfig);
    } else {
      throw new Error('invalid db config, or db config not found');
    }
    
    try {
      await this.createJobsTable();
      log('successful connection to PostgreSQL');
      this.agenda.emit('ready');
    } catch (error) {
      console.log('connection to PostgreSQL failed', error);
      log('connection to PostgreSQL failed', error);
      throw error;
    }
  }

  private hasPostgresConnection(connectOptions: unknown): connectOptions is IPostgresOptions {
		return !!(connectOptions as IPostgresOptions)?.postgres;
	}

	private hasDatabaseConfig(connectOptions: unknown): connectOptions is IPostgresOptions {
		return !!(connectOptions as IPostgresOptions)?.db?.host || !!(connectOptions as IPostgresOptions)?.db?.connectionString;
	}

  private async createJobsTable(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const schemaSQL = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
      
      // Replace placeholders in the SQL with actual values
      const formattedSQL = schemaSQL
        .replace(/\${schema}/g, this.schema)
        .replace(/\${tableName}/g, this.tableName);

      await client.query(formattedSQL);
    
      log(`Table "${this.schema}"."${this.tableName}" created or updated successfully`);
    } finally {
      client.release();
    }
  }

  private buildPostgresQuery(query: QueryCondition, type: 'SELECT' | 'DELETE', sort: Record<string, 1 | -1> = {}, limit = 0, skip = 0): { query: string, values: any[] } {
    let sqlQuery = type === 'SELECT' ? `SELECT * FROM "${this.schema}"."${this.tableName}"` : `DELETE FROM "${this.schema}"."${this.tableName}"`;
    const values: any[] = [];
    let index = 1;

    // Handle query
    if (Object.keys(query).length > 0) {
      sqlQuery += ' WHERE ';
      const conditions: any = [];
      for (let [key, value] of Object.entries(query)) {

        if(key === '_id') {
          key = 'id';
        }
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const [operator, operatorValue] = Object.entries(value)[0];
          switch (operator) {
            case 'IN':
            case 'NOT IN':
              conditions.push(`"${key}" ${operator} (${(operatorValue as unknown[]).map(_ => `$${index++}`).join(', ')})`);
              values.push(...(operatorValue as unknown[]));
              break;
            case 'JSONB_EQUALS':
              conditions.push(`"${key}"::text = $${index}`);
              values.push(JSON.stringify(operatorValue));
              index++;
              break;
            default:
              conditions.push(`"${key}" ${operator} $${index}`);
              values.push(operatorValue);
              index++;
          }
        } else {
          conditions.push(`"${key}" = $${index}`);
          values.push(value);
          index++;
        }
      }
      sqlQuery += conditions.join(' AND ');
    }

    // Handle sort
    if (Object.keys(sort).length > 0) {
      sqlQuery += ' ORDER BY ';
      sqlQuery += Object.entries(sort)
        .map(([key, value]) => `"${key}" ${value === 1 ? 'ASC' : 'DESC'}`)
        .join(', ');
    }

    // Handle limit
    if (limit > 0) {
      sqlQuery += ` LIMIT $${index}`;
      values.push(limit);
      index++;
    }

    // Handle skip
    if (skip > 0) {
      sqlQuery += ` OFFSET $${index}`;
      values.push(skip);
    }
    return { query: sqlQuery, values };
  }

  async getJobById(id: string): Promise<IJobParameters | null> {
    const result = await this.pool.query(`SELECT * FROM "${this.schema}"."${this.tableName}" WHERE id = $1`, [id]);
    return result.rows[0] || null;
  }

  async getJobs(
    query: QueryCondition,
    sort: Record<string, 1 | -1> = {},
    limit = 0,
    skip = 0
  ): Promise<IJobParameters[]> {
    try {
      const { query: sqlQuery, values } = this.buildPostgresQuery(query, 'SELECT', sort, limit, skip);
      const result = await this.pool.query(sqlQuery, values);
      return result.rows;
    } catch (error) {
      throw error;
    }
    
  }

  async removeJobs(query: QueryCondition): Promise<number> {
    const { query: sqlQuery, values } = this.buildPostgresQuery(query, 'DELETE');
    const result = await this.pool.query(sqlQuery, values);
    return result.rowCount || 0;
  }

  async purgeJobs(jobNames: string[]): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM "${this.schema}"."${this.tableName}" WHERE name NOT IN ($1) RETURNING *`,
      [jobNames]
    );
    return result.rowCount || 0;
  }

  async getQueueSize(): Promise<number> {
    const result = await this.pool.query(
      `SELECT COUNT(*) FROM "${this.schema}"."${this.tableName}" WHERE "nextRunAt" <= $1`,
      [new Date()]
    );
    return parseInt(result.rows[0].count, 10);
  }

  async unlockJob(job: Job): Promise<void> {
    await this.pool.query(
      `UPDATE "${this.schema}"."${this.tableName}" SET "lockedAt" = NULL WHERE id = $1 AND "nextRunAt" IS NOT NULL`,
      [job.attrs._id || job.attrs['id']]
    );
  }

  async unlockJobs(jobIds: string[]): Promise<void> {
    await this.pool.query(
      `UPDATE "${this.schema}"."${this.tableName}" SET "lockedAt" = NULL WHERE id = ANY($1) AND "nextRunAt" IS NOT NULL`,
      [jobIds]
    );
  }

  async lockJob(job: JobWithId): Promise<IJobParameters | undefined> {
    const result = await this.pool.query(
      `UPDATE "${this.schema}"."${this.tableName}" 
       SET "lockedAt" = $1 
       WHERE id = $2 AND name = $3 AND "lockedAt" IS NULL AND "nextRunAt" = $4 AND disabled != true
       RETURNING *`,
      [new Date(), job.attrs._id || job.attrs['id'], job.attrs.name, job.attrs.nextRunAt]
    );
    return result.rows[0];
  }

  async getNextJobToRun(
    jobName: string,
    nextScanAt: Date,
    lockDeadline: Date,
    now: Date = new Date()
  ): Promise<IJobParameters | undefined> {
    const query = `UPDATE "${this.schema}"."${this.tableName}"
       SET "lockedAt" = $1
       WHERE id = (
         SELECT id
         FROM "${this.schema}"."${this.tableName}"
         WHERE name = $2 AND disabled != true AND
           (("lockedAt" IS NULL AND "nextRunAt" <= $3) OR ("lockedAt" <= $4))
         ORDER BY ${Object.entries(this.sortConfig)
           .map(([key, value]) => `"${key}" ${value === 1 ? 'ASC' : 'DESC'}`)
           .join(', ')}
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`;

    const result = await this.pool.query(
      query,
      [now, jobName, nextScanAt, lockDeadline]
    );
    
    if (result.rows?.[0]) {
      // Convert 'id' to '_id' if it exists
      if ('id' in result.rows[0]) {
        result.rows[0]._id = result.rows[0].id;
        delete result.rows[0].id;
      }
    }
    
    return result.rows?.[0] || undefined;
  }

  private processDbResult<DATA = unknown | void>(
    job: Job<DATA>,
    res?: any
  ): Job<DATA> {
    if (res) {
      job.attrs._id = res._id || res.id;
      job.attrs.nextRunAt = res.nextRunAt;
      this.agenda.emit('processJob', job);
    }
    return job;
  }

  async saveJobState(job: Job<any>): Promise<void> {
    const updateQuery = `
      UPDATE "${this.schema}"."${this.tableName}"
      SET "lockedAt" = $1, "nextRunAt" = $2, "lastRunAt" = $3, progress = $4,
          "failReason" = $5, "failCount" = $6, "failedAt" = $7, "lastFinishedAt" = $8
      WHERE id = $9 AND name = $10
    `;
    const result = await this.pool.query(updateQuery, [
      (job.attrs.lockedAt && new Date(job.attrs.lockedAt)) || undefined,
      (job.attrs.nextRunAt && new Date(job.attrs.nextRunAt)) || undefined,
      (job.attrs.lastRunAt && new Date(job.attrs.lastRunAt)) || undefined,
      job.attrs.progress,
      job.attrs.failReason,
      job.attrs.failCount,
      job.attrs.failedAt && new Date(job.attrs.failedAt),
      (job.attrs.lastFinishedAt && new Date(job.attrs.lastFinishedAt)) || undefined,
      job.attrs._id || job.attrs['id'],
      job.attrs.name
    ]);

    if (result.rowCount !== 1) {
      throw new Error(
        `job ${job.attrs._id || job.attrs['id']} (name: ${job.attrs.name}) cannot be updated in the database, maybe it does not exist anymore?`
      );
    }

    if (job.attrs.lastRunAt && job.attrs.lastFinishedAt) {
      const insertHistoryQuery = `
        INSERT INTO "${this.schema}"."${this.tableName}ExecutionLog" ("jobId", "runAt", "finishedAt", "result", "error")
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;

      const insertHistoryValues = [
        job.attrs._id,
        job.attrs.lastRunAt,
        job.attrs.lastFinishedAt,
        job.attrs.failReason ? 'fail' : 'success',
        job.attrs.failReason || null
      ];

      const result = await this.pool.query(insertHistoryQuery, insertHistoryValues);
      log('[%s]job run history saved to PostgreSQL', job.attrs._id || job.attrs['id'], result.rows[0]);
    
      await this.getJobExecutionLog(job.attrs._id || job.attrs['id']);
      log('Job execution log saved for job %s', job.attrs._id || job.attrs['id']);
    }
  }

  async saveJob<DATA = unknown | void>(job: Job<DATA>): Promise<Job<DATA>> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const id = job.attrs._id || job.attrs['id'];

      const { _id, unique, uniqueOpts, ...props } = {
				...job.toJson(),
				// Store name of agenda queue as last modifier in job data
				lastModifiedBy: this.agenda.attrs.name
			};

      log('[job %s] set job props: \n%O', id, props);

      if(props.data) {
        props.data = JSON.stringify(props.data);
      }

      let result;
      if (id) {
        const updateQuery = `
          UPDATE "${this.schema}"."${this.tableName}" 
          SET ${Object.keys(props).map((key, index) => `"${key}" = $${index + 3}`).join(', ')}
          WHERE id = $1 AND name = $2
          RETURNING *
        `;
        result = await client.query(updateQuery, [_id, props.name, ...Object.values(props)]);
        await client.query('COMMIT');
        return this.processDbResult(job, result.rows[0]);
      }
      
      if (props.type === 'single') {
        const protect: any = {};

        // Check if the job already exists
        const jobExistsQuery = `
          SELECT id FROM "${this.schema}"."${this.tableName}" WHERE name = $1 AND "type" = 'single'
        `;
        const jobExistsResult = await client.query(jobExistsQuery, [props.name]);
        if (jobExistsResult.rowCount && jobExistsResult.rowCount > 0) {
          // Job exists, perform update
          
          const updateQuery = `
            UPDATE "${this.schema}"."${this.tableName}" 
            SET ${Object.keys(props).map((key, index) => `"${key}" = $${index + 2}`).join(', ')}
            WHERE id = $1
            RETURNING *
          `;
          log('update query', updateQuery, [jobExistsResult.rows[0].id, ...Object.values(props)]);
          result = await client.query(updateQuery, [jobExistsResult.rows[0].id, ...Object.values(props)]);
        } else {
          if (props.nextRunAt && props.nextRunAt <= new Date()) {
            protect["nextRunAt"] = props.nextRunAt;
            delete (props as Partial<IJobParameters>).nextRunAt;
          }

          const insertQuery = `
            INSERT INTO "${this.schema}"."${this.tableName}" 
            (id, "${Object.keys(props).join('", "')}")
            VALUES ($1, ${Object.keys(props).map((_, index) => `$${index + 2}`).join(', ')})
            RETURNING *
          `;
          
          result = await client.query(insertQuery, [uuidv4(), ...Object.values(props)]);
          
          if(Object.keys(protect).length > 0) {
            const result = await client.query(
              `UPDATE "${this.schema}"."${this.tableName}" 
              SET "nextRunAt" = $2
              WHERE "type" = 'single' and name = $1
              RETURNING *;
            `,
            [props.name, protect["nextRunAt"]]
            );
            log('update query result', result);
            await client.query('COMMIT');
            return this.processDbResult(job, result.rows[0]);
          }
        }
        await client.query('COMMIT');
        return this.processDbResult(job, result.rows[0]);
      }
      
      if (unique) {
        // Check if the job already exists
        const jobExistsQuery = `
          SELECT id FROM "${this.schema}"."${this.tableName}" WHERE name = $1
        `;
        const jobExistsResult = await client.query(jobExistsQuery, [props.name]);
      
        let result;
        if (jobExistsResult.rowCount && jobExistsResult.rowCount > 0) {
          // Job exists, perform update
          const updateQuery = `
            UPDATE "${this.schema}"."${this.tableName}" 
            SET ${Object.keys(props).map((key, index) => `"${key}" = $${index + 2}`).join(', ')}
            WHERE id = $1
            RETURNING *
          `;
          result = await client.query(updateQuery, [jobExistsResult.rows[0].id, ...Object.values(props)]);
        } else {
          // Job doesn't exist, perform insert
          const insertQuery = `
            INSERT INTO "${this.schema}"."${this.tableName}" 
            (id, "${Object.keys(props).join('", "')}")
            VALUES ($1, ${Object.keys(props).map((_, index) => `$${index + 2}`).join(', ')})
            RETURNING *;
          `;
          result = await client.query(insertQuery, [uuidv4(), ...Object.values(props)]);
        }
        await client.query('COMMIT');
        return this.processDbResult(job, result.rows[0]);
      }
      
      const insertQuery = `
        INSERT INTO "${this.schema}"."${this.tableName}" (id, "${Object.keys(props).join('", "')}")
        VALUES ($1, ${Object.keys(props).map((_, index) => `$${index + 2}`).join(', ')})
        RETURNING *
      `;
      const values = [uuidv4(), ...Object.values(props)];
      result = await client.query(insertQuery, values);
      

      await client.query('COMMIT');
      log('job saved to PostgreSQL', result.rows[0]);
      return this.processDbResult(job, result.rows[0]);
    } catch (error) {
      console.log('SAVE JOB ERROR', error);
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getOverview(): Promise<any[]> {
    const query = `
      WITH job_stats AS (
        SELECT
          name,
          type,
          priority,
          "repeatInterval",
          "repeatTimezone",
          COUNT(*) AS total,
          SUM(CASE WHEN "lastRunAt" IS NOT NULL AND "lastRunAt" > "lastFinishedAt" THEN 1 ELSE 0 END) AS running,
          SUM(CASE WHEN "nextRunAt" IS NOT NULL AND "nextRunAt" >= NOW() THEN 1 ELSE 0 END) AS scheduled,
          SUM(CASE WHEN "nextRunAt" IS NOT NULL AND NOW() >= "nextRunAt" AND "nextRunAt" >= "lastFinishedAt" THEN 1 ELSE 0 END) AS queued,
          SUM(CASE WHEN "lastFinishedAt" IS NOT NULL AND "lastFinishedAt" > "failedAt" THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN "lastFinishedAt" IS NOT NULL AND "failedAt" IS NOT NULL AND "lastFinishedAt" = "failedAt" THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN "repeatInterval" IS NOT NULL THEN 1 ELSE 0 END) AS repeating
        FROM "${this.schema}"."${this.tableName}"
        GROUP BY name, type, priority, "repeatInterval", "repeatTimezone"
      )
      SELECT
        name AS "_id",
        name AS "displayName",
        jsonb_agg(DISTINCT jsonb_build_object(
          'type', type,
          'priority', priority,
          'repeatInterval', "repeatInterval",
          'repeatTimezone', "repeatTimezone"
        )) AS meta,
        SUM(total) AS total,
        SUM(running) AS running,
        SUM(scheduled) AS scheduled,
        SUM(queued) AS queued,
        SUM(completed) AS completed,
        SUM(failed) AS failed,
        SUM(repeating) AS repeating
      FROM job_stats
      GROUP BY name
    `;
  
    const results = await this.pool.query(query);
  
    const states = {
      total: 0,
      running: 0,
      scheduled: 0,
      queued: 0,
      completed: 0,
      failed: 0,
      repeating: 0,
    };
    const totals = { displayName: "All Jobs", ...states };
  
    for (const job of results.rows) {
      for (const state of Object.keys(states)) {
        totals[state as keyof typeof states] += parseInt(job[state], 10);
      }
    }
  
    results.rows.unshift(totals);
    return results.rows;
  }

  async getJobExecutionLog(jobId: string): Promise<JobExecutionLog[]> {
    const query = `
      SELECT * FROM "${this.schema}"."${this.tableName}ExecutionLog" WHERE "jobId" = $1
    `;
    const result = await this.pool.query(query, [jobId]);
    return result.rows;
  }
}