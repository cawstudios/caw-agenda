import { EventEmitter } from 'events';
import debug from 'debug';

import type { Db, Filter, Sort } from 'mongodb';
import { SortDirection } from 'mongodb';
import { ForkOptions } from 'child_process';
import type { IJobDefinition } from '../jobs/interfaces/job-definition';
import type { IAgendaConfig } from './interfaces/agenda-config.interface';
import type { IAgendaStatus } from './interfaces/agenda-status.interface';
import type { IJobParameters } from '../jobs/interfaces/job-parameters';
import { Job, JobWithId } from '../jobs/job';
import { JobPriority, parsePriority } from '../utils/priority';
import { JobProcessor } from '../jobs/job-processor';
import { calculateProcessEvery } from '../utils/processEvery';
import { getCallerFilePath } from '../utils/stack';
import { IJobRepository } from '../datasource/interfaces/job-repository.interface';
import { QueryCondition } from '../types/query.type';
import { DefaultOptions } from './constants/default-options';
import { IDatabaseOptions, IDataSourceConfig, IPostgresOptions } from '../datasource/interfaces/db-config.interface';
import { IForkModeConfig } from './interfaces/fork-mode-config.interface';
import { createDbRepository } from '../datasource/data-source-factory';
import { DataSource } from '../datasource/enums/data-source.enum';
import { Pool } from 'pg';

const log = debug('agenda');

/**
 * @class
 */
export class Agenda extends EventEmitter {
	readonly attrs: IAgendaConfig & IDatabaseOptions;

	public readonly forkedWorker?: boolean;

	public readonly forkHelper?: {
		path: string;
		options?: ForkOptions;
	};

	db: IJobRepository;

	// EVENTS (Internally used)
	on(event: 'processJob', listener: (job: JobWithId) => void): this;
	on(event: 'fail', listener: (error: Error, job: JobWithId) => void): this;
	on(event: 'success', listener: (job: JobWithId) => void): this;
	on(event: 'start', listener: (job: JobWithId) => void): this;
	on(event: 'complete', listener: (job: JobWithId) => void): this;
	on(event: string, listener: (job: JobWithId) => void): this;
	on(event: string, listener: (error: Error, job: JobWithId) => void): this;
	on(event: 'ready', listener: () => void): this;
	on(event: 'error', listener: (error: Error) => void): this;
	on(event: string, listener: (...args) => void): this {
		if (this.forkedWorker && event !== 'ready' && event !== 'error') {
			const warning = new Error(`calling on(${event}) during a forkedWorker has no effect!`);
			console.warn(warning.message, warning.stack);
			return this;
		}
		return super.on(event, listener);
	}

	readonly definitions: {
		[name: string]: IJobDefinition;
	} = {};

	private jobProcessor?: JobProcessor;

	readonly ready: Promise<void>;

	isActiveJobProcessor(): boolean {
		return !!this.jobProcessor;
	}

	async runForkedJob(jobId: string) {
		const jobData = await this.db.getJobById(jobId);
		if (!jobData) {
			throw new Error('db entry not found');
		}
		const job = new Job(this, jobData);
		await job.runJob();
	}

	async getRunningStats(fullDetails = false): Promise<IAgendaStatus> {
		if (!this.jobProcessor) {
			throw new Error('agenda not running!');
		}
		return this.jobProcessor.getStatus(fullDetails);
	}

	/**
	 * @param {Object} config - Agenda Config
	 * @param {Function} cb - Callback after Agenda has started and connected to mongo
	 */
	constructor(
		config:  {
			name?: string;
			defaultConcurrency?: number;
			processEvery?: string | number;
			maxConcurrency?: number;
			defaultLockLimit?: number;
			lockLimit?: number;
			defaultLockLifetime?: number;
			// eslint-disable-next-line @typescript-eslint/ban-types
		} & IDataSourceConfig &
		IDatabaseOptions & IForkModeConfig = {
			...DefaultOptions,
			dataSource: DataSource.POSTGRES,
			dataSourceOptions: {}
		},
		cb?: (error?: Error) => void
	) {

		super();

		this.attrs = {
			name: config.name || '',
			processEvery: calculateProcessEvery(config.processEvery) || DefaultOptions.processEvery,
			defaultConcurrency: config.defaultConcurrency || DefaultOptions.defaultConcurrency,
			maxConcurrency: config.maxConcurrency || DefaultOptions.maxConcurrency,
			defaultLockLimit: config.defaultLockLimit || DefaultOptions.defaultLockLimit,
			lockLimit: config.lockLimit || DefaultOptions.lockLimit,
			defaultLockLifetime: config.defaultLockLifetime || DefaultOptions.defaultLockLifetime, // 10 minute default lockLifetime
			sort: config.sort || DefaultOptions.sort
		};

		this.forkedWorker = config.forkedWorker;
		this.forkHelper = config.forkHelper;

		this.ready = new Promise(resolve => {
			this.once('ready', resolve);
		});

		if (config.dataSource && config.dataSourceOptions && Object.keys(config.dataSourceOptions).length > 0) {
			this.db = createDbRepository(this, { dataSource: config.dataSource, dataSourceOptions: config.dataSourceOptions });
			this.db.connect();
		}

		if (cb) {
			this.ready.then(() => cb());
		}
	}

	/**
	 * Connect to the specified database server and database.
	 */
	async database(dbConfig: IDataSourceConfig): Promise<Agenda> {
		this.db = createDbRepository(this, dbConfig);
		await this.db.connect();
		return this;
	}

	/**
	 * Use existing mongo connectino to pass into agenda
	 * @param mongo
	 * @param collection
	 */
	async mongo(mongo: Db, collection?: string): Promise<Agenda> {
		return this.database({
			dataSource: DataSource.MONGO,
			dataSourceOptions: { mongo, db: { collection } }
		});
	}

	async postgres(postgres: Pool, config?: IPostgresOptions): Promise<Agenda> {
		return this.database({
			dataSource: DataSource.POSTGRES,
			dataSourceOptions: { postgres, config }
		});
	}

	/**
	 * Set the sort query for finding next job
	 * Default is { nextRunAt: 1, priority: -1 }
	 * @param query
	 */
	sort(query: { [key: string]: SortDirection }): Agenda {
		log('Agenda.sort([Object])');
		this.attrs.sort = query as any;
		return this;
	}

	/**
	 * Cancels any jobs matching the passed MongoDB query, and removes them from the database.
	 * @param query
	 */
	async cancel(query: Filter<IJobParameters>): Promise<number> {
		log('attempting to cancel all Agenda jobs', query);
		try {
			const amountOfRemovedJobs = await this.db.removeJobs(query as QueryCondition);
			log('%s jobs cancelled', amountOfRemovedJobs);
			return amountOfRemovedJobs;
		} catch (error) {
			log('error trying to delete jobs from MongoDB');
			throw error;
		}
	}

	/**
	 * Set name of queue
	 * @param name
	 */
	name(name: string): Agenda {
		log('Agenda.name(%s)', name);
		this.attrs.name = name;
		return this;
	}

	/**
	 * Set the time how often the job processor checks for new jobs to process
	 * @param time
	 */
	processEvery(time: string | number): Agenda {
		if (this.jobProcessor) {
			throw new Error(
				'job processor is already running, you need to set processEvery before calling start'
			);
		}
		log('Agenda.processEvery(%d)', time);
		this.attrs.processEvery = calculateProcessEvery(time);
		return this;
	}

	/**
	 * Set the concurrency for jobs (globally), type does not matter
	 * @param num
	 */
	maxConcurrency(num: number): Agenda {
		log('Agenda.maxConcurrency(%d)', num);
		this.attrs.maxConcurrency = num;
		return this;
	}

	/**
	 * Set the default concurrency for each job
	 * @param num number of max concurrency
	 */
	defaultConcurrency(num: number): Agenda {
		log('Agenda.defaultConcurrency(%d)', num);
		this.attrs.defaultConcurrency = num;
		return this;
	}

	/**
	 * Set the default amount jobs that are allowed to be locked at one time (GLOBAL)
	 * @param num
	 */
	lockLimit(num: number): Agenda {
		log('Agenda.lockLimit(%d)', num);
		this.attrs.lockLimit = num;
		return this;
	}

	/**
	 * Set default lock limit per job type
	 * @param num
	 */
	defaultLockLimit(num: number): Agenda {
		log('Agenda.defaultLockLimit(%d)', num);
		this.attrs.defaultLockLimit = num;
		return this;
	}

	/**
	 * Set the default lock time (in ms)
	 * Default is 10 * 60 * 1000 ms (10 minutes)
	 * @param ms
	 */
	defaultLockLifetime(ms: number): Agenda {
		log('Agenda.defaultLockLifetime(%d)', ms);
		this.attrs.defaultLockLifetime = ms;
		return this;
	}

	/**
	 * Finds all jobs matching 'query'
	 * @param query
	 * @param sort
	 * @param limit
	 * @param skip
	 */
	async jobs(
		query: Filter<IJobParameters> = {},
		sort: Sort = {},
		limit = 0,
		skip = 0
	): Promise<Job[]> {
		const result = await this.db.getJobs(query as QueryCondition, sort, limit, skip);
		return result.map(job => new Job(this, job));
	}

	/**
	 * Removes all jobs from queue
	 * @note: Only use after defining your jobs
	 */
	async purge(): Promise<number> {
		const definedNames = Object.keys(this.definitions);
		log('attempting to purge all Agenda jobs', definedNames);
		try {
			const amountOfRemovedJobs = await this.db.purgeJobs(definedNames);
			log('%s jobs purged', amountOfRemovedJobs);
			return amountOfRemovedJobs;
		} catch (error) {
			log('error trying to purge jobs from MongoDB');
			throw error;
		}
	}

	/**
	 * Setup definition for job
	 * Method is used by consumers of lib to setup their functions
	 * BREAKING CHANGE in v4: options moved from 2nd to 3rd parameter!
	 * @param name
	 * @param processor
	 * @param options
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	define<DATA = any>(
		name: string,
		processor: (agendaJob: Job<DATA>, done: (error?: Error) => void) => void,
		options?: Partial<Pick<IJobDefinition, 'lockLimit' | 'lockLifetime' | 'concurrency'>> & {
			priority?: JobPriority;
		}
	): void;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	define<DATA = any>(
		name: string,
		processor: (agendaJob: Job<DATA>) => Promise<void>,
		options?: Partial<Pick<IJobDefinition, 'lockLimit' | 'lockLifetime' | 'concurrency'>> & {
			priority?: JobPriority;
		}
	): void;
	define(
		name: string,
		processor: ((job: Job) => Promise<void>) | ((job: Job, done) => void),
		options?: Partial<Pick<IJobDefinition, 'lockLimit' | 'lockLifetime' | 'concurrency'>> & {
			priority?: JobPriority;
		}
	): void {
		if (this.definitions[name]) {
			log('overwriting already defined agenda job', name);
		}

		const filePath = getCallerFilePath();

		this.definitions[name] = {
			fn: processor,
			filePath,
			concurrency: options?.concurrency || this.attrs.defaultConcurrency,
			lockLimit: options?.lockLimit || this.attrs.defaultLockLimit,
			priority: parsePriority(options?.priority),
			lockLifetime: options?.lockLifetime || this.attrs.defaultLockLifetime
		};
		log('job [%s] defined with following options: \n%O', name, this.definitions[name]);
	}

	/**
	 * Internal helper method that uses createJob to create jobs for an array of names
	 * @param {Number} interval run every X interval
	 * @param {Array<String>} names Strings of jobs to schedule
	 * @param {Object} data data to run for job
	 * @param {Object} options options to run job for
	 * @returns {Array<Job>} array of jobs created
	 */
	private async createJobs<DATA = unknown>(
		names: string[],
		createJob: (name: string) => Promise<Job<DATA>>
	): Promise<Job<DATA>[]> {
		try {
			const jobs = await Promise.all(names.map(name => createJob(name)));

			log('createJobs() -> all jobs created successfully');

			return jobs;
		} catch (error) {
			log('createJobs() -> error creating one or more of the jobs', error);
			throw error;
		}
	}

	/**
	 * Given a name and some data, create a new job
	 * @param name
	 */
	create(name: string): Job<void>;
	create<DATA = unknown>(name: string, data: DATA): Job<DATA>;
	create(name: string, data?: unknown): Job<any> {
		log('Agenda.create(%s, [Object])', name);
		const priority = this.definitions[name] ? this.definitions[name].priority : 0;
		const job = new Job(this, { name, data, type: 'normal', priority });
		return job;
	}

	/**
	 * Creates a scheduled job with given interval and name/names of the job to run
	 * @param interval
	 * @param names
	 * @param data
	 * @param options
	 */
	async every(
		interval: string | number,
		names: string[],
		data?: undefined,
		options?: { timezone?: string; skipImmediate?: boolean; forkMode?: boolean }
	): Promise<Job<void>[]>;
	async every(
		interval: string | number,
		name: string,
		data?: undefined,
		options?: { timezone?: string; skipImmediate?: boolean; forkMode?: boolean }
	): Promise<Job<void>>;
	async every<DATA = unknown>(
		interval: string | number,
		names: string[],
		data: DATA,
		options?: { timezone?: string; skipImmediate?: boolean; forkMode?: boolean }
	): Promise<Job<DATA>[]>;
	async every<DATA = unknown>(
		interval: string | number,
		name: string,
		data: DATA,
		options?: { timezone?: string; skipImmediate?: boolean; forkMode?: boolean }
	): Promise<Job<DATA>>;
	async every(
		interval: string | number,
		names: string | string[],
		data?: unknown,
		options?: { timezone?: string; skipImmediate?: boolean; forkMode?: boolean }
	): Promise<Job<any> | Job<any>[]> {
		/**
		 * Internal method to setup job that gets run every interval
		 * @param {Number} interval run every X interval
		 * @param {String} name String job to schedule
		 * @param {Object} data data to run for job
		 * @param {Object} options options to run job for
		 * @returns {Job} instance of job
		 */
		log('Agenda.every(%s, %O, %O)', interval, names, options);

		const createJob = async (name: string): Promise<Job> => {
			const job = this.create(name, data);
			job.attrs.type = 'single';
			job.repeatEvery(interval, options);
			if (options?.forkMode) {
				job.forkMode(options.forkMode);
			}
			await job.save();

			return job;
		};

		if (typeof names === 'string') {
			const job = await createJob(names);

			return job;
		}

		log('Agenda.every(%s, %s, %O)', interval, names, options);
		const jobs = await this.createJobs(names, createJob);

		return jobs;
	}

	/**
	 * Schedule a job or jobs at a specific time
	 * @param when
	 * @param names
	 */
	async schedule<DATA = void>(when: string | Date, names: string[]): Promise<Job<DATA>[]>;
	async schedule<DATA = void>(when: string | Date, names: string): Promise<Job<DATA>>;
	async schedule<DATA = unknown>(
		when: string | Date,
		names: string[],
		data: DATA
	): Promise<Job<DATA>[]>;
	async schedule<DATA = unknown>(when: string | Date, name: string, data: DATA): Promise<Job<DATA>>;
	async schedule(
		when: string | Date,
		names: string | string[],
		data?: unknown
	): Promise<Job | Job[]> {
		const createJob = async (name: string) => {
			const job = this.create(name, data);

			await job.schedule(when).save();

			return job;
		};

		if (typeof names === 'string') {
			log('Agenda.schedule(%s, %O, [%O])', when, names);
			return createJob(names);
		}

		log('Agenda.schedule(%s, %O, [%O])', when, names);
		return this.createJobs(names, createJob);
	}

	/**
	 * Create a job for this exact moment
	 * @param name
	 */
	async now<DATA = void>(name: string): Promise<Job<DATA>>;
	async now<DATA = unknown>(name: string, data: DATA): Promise<Job<DATA>>;
	async now<DATA>(name: string, data?: DATA): Promise<Job<DATA | void>> {
		log('Agenda.now(%s, [Object])', name);
		try {
			const job = this.create(name, data);

			job.schedule(new Date());
			await job.save();

			return job as Job<DATA | void>;
		} catch (error) {
			log('error trying to create a job for this exact moment');
			throw error;
		}
	}

	/**
	 * Starts processing jobs using processJobs() methods, storing an interval ID
	 * This method will only resolve if a db has been set up beforehand.
	 */
	async start(): Promise<void> {
		log(
			'Agenda.start called, waiting for agenda to be initialized (db connection)',
			this.attrs.processEvery
		);
		await this.ready;
		if (this.jobProcessor) {
			log('Agenda.start was already called, ignoring');
			return;
		}

		this.jobProcessor = new JobProcessor(
			this,
			this.attrs.maxConcurrency,
			this.attrs.lockLimit,
			this.attrs.processEvery
		);

		this.on('processJob', this.jobProcessor.process.bind(this.jobProcessor));
	}

	/**
	 * Clear the interval that processes the jobs and unlocks all currently locked jobs
	 */
	async stop(): Promise<void> {
		if (!this.jobProcessor) {
			log('Agenda.stop called, but agenda has never started!');
			return;
		}

		log('Agenda.stop called, clearing interval for processJobs()');

		const lockedJobs = this.jobProcessor.stop();

		log('Agenda._unlockJobs()');
		const jobIds = lockedJobs?.map(job => job.attrs._id || job.attrs['id']) || [];

		if (jobIds.length > 0) {
			log('about to unlock jobs with ids: %O', jobIds);
			await this.db.unlockJobs(jobIds);
		}

		this.off('processJob', this.jobProcessor.process.bind(this.jobProcessor));

		this.jobProcessor = undefined;
	}

	async getJobExecutionLog(jobId: string): Promise<any[]> {
		return this.db.getJobExecutionLog(jobId);
	}
}
