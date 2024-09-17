import { Agenda } from '../../src';
import { DataSource } from '../../src/datasource/enums/data-source.enum';

process.on('message', message => {
	if (message === 'cancel') {
		process.exit(2);
	} else {
		console.log('got message', message);
	}
});

(async () => {
	/** do other required initializations */

	// get process arguments (name, jobId and path to agenda definition file)
	const [, , name, jobId, agendaDefinition] = process.argv;

	// set fancy process title
	process.title = `${process.title} (sub worker: ${name}/${jobId})`;

	// initialize Agenda in "forkedWorker" mode
	const agenda = new Agenda({ name: `subworker-${name}`, forkedWorker: true });
	
	// Update this
	await agenda.database({
		dataSource: process.env.DB_TYPE as DataSource,
		dataSourceOptions: JSON.parse(process.env.DB_CONFIG!)
	});

	if (!name || !jobId) {
		throw new Error(`invalid parameters: ${JSON.stringify(process.argv)}`);
	}

	// load job definition
	/** in this case the file is for example ../some/path/definitions.js
   with a content like:
   export default (agenda: Agenda, definitionOnly = false) => {
    agenda.define(
      'some job',
      async (notification: {
        attrs: { data: { dealId: string; orderId: TypeObjectId<IOrder> } };
      }) => {
        // do something
      }
    );

    if (!definitionOnly) {
        // here you can create scheduled jobs or other things
    }
	});
   */
	if (agendaDefinition) {
		const loadDefinition = await import(agendaDefinition);
		(loadDefinition.default || loadDefinition)(agenda, true);
	}

	// run this job now
	await agenda.runForkedJob(jobId);

	// disconnect database and exit
	process.exit(0);
})().catch(err => {
	console.error('err', err);
	if (process.send) {
		process.send(JSON.stringify(err));
	}
	process.exit(1);
});
