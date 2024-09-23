export const DefaultOptions = {
	processEvery: 5000,
	defaultConcurrency: 5,
	maxConcurrency: 20,
	defaultLockLimit: 0,
	lockLimit: 0,
	defaultLockLifetime: 10 * 60 * 1000,
	sort: { nextRunAt: 1, priority: -1 } as const,
	forkHelper: { path: 'dist/childWorker.js' }
};