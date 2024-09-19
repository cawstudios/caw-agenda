/* eslint-disable no-console,no-unused-expressions,@typescript-eslint/no-unused-expressions */

import delay from 'delay';
import { Pool } from 'pg';
import { mockPostgres } from './helpers/mock-postgresdb';

import { Agenda, Job } from '../src';
import { expect } from 'chai';
import { DataSource } from '../src/datasource/enums/data-source.enum';
import sinon = require('sinon');
import path = require('path');

// agenda instances
let globalAgenda: Agenda;

// connection string to postgres
const postgresCfg = {
	schema: 'agendaJobs',
	tableName: 'CronJobs'
}

// postgres connection pool instance
let postgresPool: Pool;

const clearJobs = async (): Promise<void> => {
	if (postgresPool) {
		try {
			await postgresPool.query(`
				BEGIN;
				DELETE FROM "${postgresCfg.schema}"."${postgresCfg.tableName}RunHistory";
				DELETE FROM "${postgresCfg.schema}"."${postgresCfg.tableName}";
				COMMIT;
			`);	
		} catch (error) {
			console.log(error);
		}
	}
};

// Slow timeouts for Travis
const jobTimeout = 500;
const jobType = 'do work';
const jobProcessor = () => {};

describe.skip('Agenda with PostgreSQL', () => {

	beforeEach(async () => {
		if (!postgresPool) {
			const mockedPostgres = await mockPostgres();
			postgresPool = mockedPostgres.pool;
		}

		return new Promise(resolve => {
			globalAgenda = new Agenda(
				{
					dataSource: DataSource.POSTGRES,
					dataSourceOptions: { postgres: postgresPool }
				},
				async () => {
					await delay(50);
					await clearJobs();
					globalAgenda.define('someJob', jobProcessor);
					globalAgenda.define('send email', jobProcessor);
					globalAgenda.define('some job', jobProcessor);
					globalAgenda.define(jobType, jobProcessor);
					return resolve();
				}
			);
		});
	});

	afterEach(async () => {
		await delay(50);
		if (globalAgenda) {
			await globalAgenda.stop();
			await clearJobs();
		}
	});

	it('sets a default processEvery', () => {
		expect(globalAgenda.attrs.processEvery).to.equal(5000);
	});

	describe('configuration methods', () => {
		it('sets the _db directly when passed as an option', () => {
			const agendaDb = new Agenda({
				dataSource: DataSource.POSTGRES,
				dataSourceOptions: { postgres: postgresPool }
			});
			expect(agendaDb.db).to.not.equal(undefined);
		});
	});

	describe('configuration methods', () => {
		// describe('postgres connection tester', () => {
		// 	it('passing a valid server connection string', () => {
		// 		expect(hasPostgresProtocol(postgresCfg)).to.equal(true);
		// 	});

		// 	it('passing an invalid connection string', () => {
		// 		expect(hasPostgresProtocol(`localhost/agenda-test`)).to.equal(false);
		// 	});
		// });

		describe('db', () => {
			it('sets the _db directly', () => {
				const agenda = new Agenda();
				agenda.postgres(postgresPool);
				expect(agenda.db).to.not.equal(undefined);
			});

			it('returns itself', async () => {
				const agenda = new Agenda();
				expect(await agenda.postgres(postgresPool)).to.equal(agenda);
			});
		});

		describe('name', () => {
			it('sets the agenda name', () => {
				globalAgenda.name('test queue');
				expect(globalAgenda.attrs.name).to.equal('test queue');
			});
			it('returns itself', () => {
				expect(globalAgenda.name('test queue')).to.equal(globalAgenda);
			});
		});
		describe('processEvery', () => {
			it('sets the processEvery time', () => {
				globalAgenda.processEvery('3 minutes');
				expect(globalAgenda.attrs.processEvery).to.equal(180000);
			});
			it('returns itself', () => {
				expect(globalAgenda.processEvery('3 minutes')).to.equal(globalAgenda);
			});
		});
		describe('maxConcurrency', () => {
			it('sets the maxConcurrency', () => {
				globalAgenda.maxConcurrency(10);
				expect(globalAgenda.attrs.maxConcurrency).to.equal(10);
			});
			it('returns itself', () => {
				expect(globalAgenda.maxConcurrency(10)).to.equal(globalAgenda);
			});
		});
		describe('defaultConcurrency', () => {
			it('sets the defaultConcurrency', () => {
				globalAgenda.defaultConcurrency(1);
				expect(globalAgenda.attrs.defaultConcurrency).to.equal(1);
			});
			it('returns itself', () => {
				expect(globalAgenda.defaultConcurrency(5)).to.equal(globalAgenda);
			});
		});
		describe('lockLimit', () => {
			it('sets the lockLimit', () => {
				globalAgenda.lockLimit(10);
				expect(globalAgenda.attrs.lockLimit).to.equal(10);
			});
			it('returns itself', () => {
				expect(globalAgenda.lockLimit(10)).to.equal(globalAgenda);
			});
		});
		describe('defaultLockLimit', () => {
			it('sets the defaultLockLimit', () => {
				globalAgenda.defaultLockLimit(1);
				expect(globalAgenda.attrs.defaultLockLimit).to.equal(1);
			});
			it('returns itself', () => {
				expect(globalAgenda.defaultLockLimit(5)).to.equal(globalAgenda);
			});
		});
		describe('defaultLockLifetime', () => {
			it('returns itself', () => {
				expect(globalAgenda.defaultLockLifetime(1000)).to.equal(globalAgenda);
			});
			it('sets the default lock lifetime', () => {
				globalAgenda.defaultLockLifetime(9999);
				expect(globalAgenda.attrs.defaultLockLifetime).to.equal(9999);
			});
			it('is inherited by jobs', () => {
				globalAgenda.defaultLockLifetime(7777);
				globalAgenda.define('testDefaultLockLifetime', () => {});
				expect(globalAgenda.definitions.testDefaultLockLifetime.lockLifetime).to.equal(7777);
			});
		});
		describe('sort', () => {
			it('returns itself', () => {
				expect(globalAgenda.sort({ nextRunAt: 1, priority: -1 })).to.equal(globalAgenda);
			});
			it('sets the default sort option', () => {
				globalAgenda.sort({ nextRunAt: -1 });
				expect(globalAgenda.attrs.sort).to.eql({ nextRunAt: -1 });
			});
		});
	});

	describe('job methods', () => {
		describe('create', () => {
			let job;
			beforeEach(() => {
				job = globalAgenda.create('sendEmail', { to: 'some guy' });
			});

			it('returns a job', () => {
				expect(job).to.be.an.instanceof(Job);
			});
			it('sets the name', () => {
				expect(job.attrs.name).to.equal('sendEmail');
			});
			it('sets the type', () => {
				expect(job.attrs.type).to.equal('normal');
			});
			it('sets the agenda', () => {
				expect(job.agenda).to.equal(globalAgenda);
			});
			it('sets the data', () => {
				expect(job.attrs.data).to.have.property('to', 'some guy');
			});
		});

		describe('define', () => {
			it('stores the definition for the job', () => {
				expect(globalAgenda.definitions.someJob).to.have.property('fn', jobProcessor);
			});

			it('sets the default concurrency for the job', () => {
				expect(globalAgenda.definitions.someJob).to.have.property('concurrency', 5);
			});

			it('sets the default lockLimit for the job', () => {
				expect(globalAgenda.definitions.someJob).to.have.property('lockLimit', 0);
			});

			it('sets the default priority for the job', () => {
				expect(globalAgenda.definitions.someJob).to.have.property('priority', 0);
			});
			it('takes concurrency option for the job', () => {
				globalAgenda.define('highPriority', jobProcessor, { priority: 10 });
				expect(globalAgenda.definitions.highPriority).to.have.property('priority', 10);
			});
		});

		describe('every', () => {
			describe('with a job name specified', () => {
				it('returns a job', async () => {
					expect(await globalAgenda.every('5 minutes', 'send email')).to.be.an.instanceof(Job);
				});
				it('sets the repeatEvery', async () => {
					expect(
						await globalAgenda
							.every('5 seconds', 'send email')
							.then(({ attrs }) => attrs.repeatInterval)
					).to.equal('5 seconds');
				});
				it('sets the agenda', async () => {
					expect(
						await globalAgenda.every('5 seconds', 'send email').then(({ agenda }) => agenda)
					).to.equal(globalAgenda);
				});
				it('should update a job that was previously scheduled with `every`', async () => {
					await globalAgenda.every(10, 'shouldBeSingleJob');
					await delay(10);
					await globalAgenda.every(20, 'shouldBeSingleJob');

					// Give the saves a little time to propagate
					await delay(jobTimeout);

					const res = await globalAgenda.jobs({ name: 'shouldBeSingleJob' });
					expect(res).to.have.length(1);
				});
				it('should not run immediately if options.skipImmediate is true', async () => {
					const jobName = 'send email';
					await globalAgenda.every('5 minutes', jobName, {}, { skipImmediate: true });
					const job = (await globalAgenda.jobs({ name: jobName }))[0];
					const nextRunAt = job.attrs.nextRunAt!.getTime();
					const now = new Date().getTime();
					expect(nextRunAt - now > 0).to.equal(true);
				});
				it('should run immediately if options.skipImmediate is false', async () => {
					const jobName = 'send email';
					await globalAgenda.every('5 minutes', jobName, {}, { skipImmediate: false });
					const job = (await globalAgenda.jobs({ name: jobName }))[0];
					const nextRunAt = job.attrs.nextRunAt!.getTime();
					const now = new Date().getTime();
					expect(nextRunAt - now <= 0).to.equal(true);
				});
			});
			describe('with array of names specified', () => {
				it('returns array of jobs', async () => {
					expect(await globalAgenda.every('5 minutes', ['send email', 'some job'])).to.be.an(
						'array'
					);
				});
			});
		});

		describe('schedule', () => {
			describe('with a job name specified', () => {
				it('returns a job', async () => {
					expect(await globalAgenda.schedule('in 5 minutes', 'send email')).to.be.an.instanceof(
						Job
					);
				});
				it('sets the schedule', async () => {
					const fiveish = new Date().valueOf() + 250000;
					const scheduledJob = await globalAgenda.schedule('in 5 minutes', 'send email');
					expect(scheduledJob.attrs.nextRunAt!.valueOf()).to.be.greaterThan(fiveish);
				});
			});
			describe('with array of names specified', () => {
				it('returns array of jobs', async () => {
					expect(await globalAgenda.schedule('5 minutes', ['send email', 'some job'])).to.be.an(
						'array'
					);
				});
			});
		});

		describe('unique', () => {
			describe('should demonstrate unique contraint', () => {
				it('should modify one job when unique matches', async () => {
					const job1 = await globalAgenda
						.create('unique job', {
							type: 'active',
							userId: '123',
							other: true
						});
					

					await job1.unique({
						'data.type': 'active',
						'data.userId': '123'
					})
					.schedule('now')
					.save();

					await delay(100);

					const job2 = await globalAgenda
						.create('unique job', {
							type: 'active',
							userId: '123',
							other: false
						})


					await job2.unique({
						'data.type': 'active',
						'data.userId': '123'
					})
					.schedule('now')
					.save();

					expect(job1.attrs.nextRunAt!.toISOString()).not.to.equal(
						job2.attrs.nextRunAt!.toISOString()
					);

					const jobs = await globalAgenda.jobs({ name: 'unique job' });
					expect(jobs).to.have.length(1);
				});

				it('should not modify job when unique matches and insertOnly is set to true', async () => {
					const job1 = await globalAgenda
						.create('unique job', {
							type: 'active',
							userId: '123',
							other: true
						})
						.unique(
							{
								'data.type': 'active',
								'data.userId': '123'
							},
							{
								insertOnly: true
							}
						)
						.schedule('now')
						.save();

					const job2 = await globalAgenda
						.create('unique job', {
							type: 'active',
							userId: '123',
							other: false
						})
						.unique(
							{
								'data.type': 'active',
								'data.userId': '123'
							},
							{
								insertOnly: true
							}
						)
						.schedule('now')
						.save();

					// expect(job1.attrs.nextRunAt!.toISOString()).to.equal(job2.attrs.nextRunAt!.toISOString());

					const jobs = await globalAgenda.jobs({ name: 'unique job' });
					expect(jobs).to.have.length(1);
				});
			});

			// describe('should demonstrate non-unique contraint', () => {
			// 	it("should create two jobs when unique doesn't match", async () => {
			// 		const time = new Date(Date.now() + 1000 * 60 * 3);
			// 		const time2 = new Date(Date.now() + 1000 * 60 * 4);

			// 		await globalAgenda
			// 			.create('unique job', {
			// 				type: 'active',
			// 				userId: '123',
			// 				other: true
			// 			})
			// 			.unique({
			// 				'data.type': 'active',
			// 				'data.userId': '123',
			// 				nextRunAt: time
			// 			})
			// 			.schedule(time)
			// 			.save();

			// 		await globalAgenda
			// 			.create('unique job', {
			// 				type: 'active',
			// 				userId: '123',
			// 				other: false
			// 			})
			// 			.unique({
			// 				'data.type': 'active',
			// 				'data.userId': '123',
			// 				nextRunAt: time2
			// 			})
			// 			.schedule(time)
			// 			.save();

			// 		const jobs = await globalAgenda.jobs({ name: 'unique job' });
			// 		expect(jobs).to.have.length(2);
			// 	});
			// });
		});

		describe('now', () => {
			it('returns a job', async () => {
				expect(await globalAgenda.now('send email')).to.be.an.instanceof(Job);
			});
			it('sets the schedule', async () => {
				const now = new Date();
				expect(
					await globalAgenda.now('send email').then(({ attrs }) => attrs.nextRunAt!.valueOf())
				).to.be.greaterThan(now.valueOf() - 1);
			});

			it('runs the job immediately', async () => {
				globalAgenda.define('immediateJob', async job => {
					expect(await job.isRunning()).to.be.equal(true);
					await globalAgenda.stop();
				});
				await globalAgenda.now('immediateJob');
				await globalAgenda.start();
			});
		});

		describe('jobs', () => {
			it('returns jobs', async () => {
				await globalAgenda.create('test').save();
				const c = await globalAgenda.jobs({});

				expect(c.length).to.not.equal(0);
				expect(c[0]).to.be.an.instanceof(Job);
				await clearJobs();
			});
		});

		describe('purge', () => {
			it('removes all jobs without definitions', async () => {
				const job = globalAgenda.create('no definition');
				await globalAgenda.stop();
				await job.save();
				const j = await globalAgenda.jobs({
					name: 'no definition'
				});

				expect(j).to.have.length(1);
				await globalAgenda.purge();
				const jAfterPurge = await globalAgenda.jobs({
					name: 'no definition'
				});

				expect(jAfterPurge).to.have.length(0);
			});
		});

		describe('saveJob', () => {
			it('persists job to the database', async () => {
				const job = globalAgenda.create('someJob', {});
				await job.save();

				expect(job.attrs._id).to.not.be.equal(undefined);

				await clearJobs();
			});
		});
	});

	describe('cancel', () => {
		beforeEach(async () => {
			let remaining = 3;
			const checkDone = () => {
				remaining -= 1;
			};

			await globalAgenda.create('jobA').save().then(checkDone);
			await globalAgenda.create('jobA', 'someData').save().then(checkDone);
			await globalAgenda.create('jobB').save().then(checkDone);
			expect(remaining).to.equal(0);
		});

		afterEach(async () => {
			await globalAgenda.db.removeJobs({ name: { 'IN': ['jobA', 'jobB'] } });
		});

		it('should cancel a job', async () => {
			const j = await globalAgenda.jobs({ name: { '=': 'jobA'} });
			expect(j).to.have.length(2);

			await globalAgenda.cancel({ name: 'jobA' });
			const job = await globalAgenda.jobs({ name: 'jobA' });

			expect(job).to.have.length(0);
		});

		it('should cancel multiple jobs', async () => {
			const jobs1 = await globalAgenda.jobs({ name: { 'IN': ['jobA', 'jobB'] } });
			expect(jobs1).to.have.length(3);
			await globalAgenda.cancel({ name: { 'IN': ['jobA', 'jobB'] } });

			const jobs2 = await globalAgenda.jobs({ name: { 'IN': ['jobA', 'jobB'] } });
			expect(jobs2).to.have.length(0);
		});

		it('should cancel jobs only if the data matches', async () => {
			const jobs1 = await globalAgenda.jobs({ name: { '=': 'jobA'}, data: { 'JSONB_EQUALS': 'someData'} });
			expect(jobs1).to.have.length(1);
			await globalAgenda.cancel({ name: { '=': 'jobA'}, data: { 'JSONB_EQUALS': 'someData'} });

			const jobs2 = await globalAgenda.jobs({ name: { '=': 'jobA'}, data: { 'JSONB_EQUALS': 'someData'} });
			expect(jobs2).to.have.length(0);

			const jobs3 = await globalAgenda.jobs({ name: { '=': 'jobA'} });
			expect(jobs3).to.have.length(1);
		});
	});

	describe('search', () => {
		beforeEach(async () => {
			await globalAgenda.create('jobA', 1).save();
			await globalAgenda.create('jobA', 2).save();
			await globalAgenda.create('jobA', 3).save();
		});

		afterEach(async () => {
			await globalAgenda.db.removeJobs({ name: 'jobA' });
		});

		it('should limit jobs', async () => {
			const results = await globalAgenda.jobs({ name: 'jobA' }, {}, 2);
			expect(results).to.have.length(2);
		});

		it('should skip jobs', async () => {
			const results = await globalAgenda.jobs({ name: 'jobA' }, {}, 2, 2);
			expect(results).to.have.length(1);
		});

		it('should sort jobs', async () => {
			const results = await globalAgenda.jobs({ name: 'jobA' }, { data: -1 });

			expect(results).to.have.length(3);

			const job1 = results[0];
			const job2 = results[1];
			const job3 = results[2];

			expect(job1.attrs.data).to.equal(3);
			expect(job2.attrs.data).to.equal(2);
			expect(job3.attrs.data).to.equal(1);
		});
	});

	describe('process jobs', () => {
		it('do not run failed jobs again', async () => {
			const unhandledRejections: any[] = [];
			const rejectionsHandler = error => unhandledRejections.push(error);
			process.on('unhandledRejection', rejectionsHandler);

			let jprocesses = 0;

			globalAgenda.define('failing job', async _job => {
				jprocesses++;
				throw new Error('failed');
			});

			let failCalled = false;
			globalAgenda.on('fail:failing job', _err => {
				failCalled = true;
			});

			let errorCalled = false;
			globalAgenda.on('error', _err => {
				errorCalled = true;
			});

			globalAgenda.processEvery(100);
			await globalAgenda.start();

			await globalAgenda.now('failing job');

			await delay(1000);

			process.removeListener('unhandledRejection', rejectionsHandler);

			expect(jprocesses).to.be.equal(1);
			expect(errorCalled).to.be.false;
			expect(failCalled).to.be.true;
			expect(unhandledRejections).to.have.length(0);
		}).timeout(10000);

		it('ensure there is no unhandledPromise on job timeouts', async () => {
			const unhandledRejections: any[] = [];
			const rejectionsHandler = error => unhandledRejections.push(error);
			process.on('unhandledRejection', rejectionsHandler);

			globalAgenda.define(
				'very short timeout',
				(_job, done) => {
					setTimeout(() => {
						done();
					}, 10000);
				},
				{
					lockLifetime: 100
				}
			);

			let errorCalled = false;
			globalAgenda.on('error', _err => {
				errorCalled = true;
			});

			globalAgenda.processEvery(100);
			await globalAgenda.start();

			await globalAgenda.now('very short timeout');

			await delay(500);

			process.removeListener('unhandledRejection', rejectionsHandler);

			expect(errorCalled).to.be.true;
			expect(unhandledRejections).to.have.length(0);
		}).timeout(10000);

		it('should not cause unhandledRejection', async () => {
			const unhandledRejections: any[] = [];
			const rejectionsHandler = error => unhandledRejections.push(error);
			process.on('unhandledRejection', rejectionsHandler);

			let j1processes = 0;

			globalAgenda.define('j1', (_job, done) => {
				j1processes += 1;
				done();
			});

			let j2processes = 0;
			globalAgenda.define('j2', (_job, done) => {
				j2processes += 1;
				done();
			});

			let j3processes = 0;
			globalAgenda.define('j3', async _job => {
				j3processes += 1;
			});
			await globalAgenda.start();

			await globalAgenda.every('5 seconds', 'j1');
			await globalAgenda.every('10 seconds', 'j2');
			await globalAgenda.every('15 seconds', 'j3');

			await delay(3001);

			process.removeListener('unhandledRejection', rejectionsHandler);

			expect(j1processes).to.be.greaterThanOrEqual(1);
			expect(j2processes).to.equal(1);
			expect(j3processes).to.equal(1);

			expect(unhandledRejections).to.have.length(0);
		}).timeout(10500);
	});
});