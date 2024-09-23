import type { Job, JobWithId } from '../../jobs/job';
import type { IJobParameters } from '../../jobs/interfaces/job-parameters';
import { QueryCondition } from '../../types/query.type';
import { JobExecutionLog } from '../../jobs/interfaces/job-execution-log';

export interface IJobRepository {
  connect(): Promise<void>;

  getJobById(id: string): Promise<IJobParameters | null>;
  getJobs(query: QueryCondition, sort?: any, limit?: number, skip?: number): Promise<IJobParameters[]>;
  
  removeJobs(query: QueryCondition): Promise<number>;
  purgeJobs(jobNames: string[]): Promise<number>;
  getQueueSize(): Promise<number>;
  
  lockJob(job: JobWithId): Promise<IJobParameters | undefined>;
  unlockJob(job: Job): Promise<void>;
  unlockJobs(jobIds: any[]): Promise<void>;
  
  saveJob<DATA = unknown | void>(job: Job<DATA>): Promise<Job<DATA>>;
  saveJobState(job: Job<any>): Promise<void>;
  
  getNextJobToRun(jobName: string, nextScanAt: Date, lockDeadline: Date, now?: Date): Promise<IJobParameters | undefined>;

  getOverview(): Promise<any[]>;
  getJobExecutionLog(jobId: string): Promise<JobExecutionLog[]>;
}
