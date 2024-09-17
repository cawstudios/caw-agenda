import { Agenda } from '../../src';
import { DataSource } from '../../src/datasource/enums/data-source.enum';
import addTests from './add-tests';

const dbType = process.argv[2] as DataSource;
const dbConfig = JSON.parse(process.argv[3]);
const tests = process.argv.slice(4);

const agenda = new Agenda(
	{
		dataSource: dbType,
		dataSourceOptions: dbConfig,
		processEvery: 100
	},
	async () => {
		tests.forEach(test => {
			addTests[test](agenda);
		});

		await agenda.start();

		// Ensure we can shut down the process from tests
		process.on('message', msg => {
			if (msg === 'exit') {
				process.exit(0);
			}
		});

		// Send default message of "notRan" after 400ms
		setTimeout(() => {
			process.send!('notRan');
			// eslint-disable-next-line unicorn/no-process-exit
			process.exit(0);
		}, 400);
	}
);
