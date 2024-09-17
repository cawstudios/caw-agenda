import { IDataSourceConfig } from '../datasource/interfaces/db-config.interface';
import { IJobRepository } from '../datasource/interfaces/job-repository.interface';
import { MongoJobRepository } from '../datasource/mongo/mongo-job.repository';
import { PostgresJobRepository } from './postgres/postgres-job.repository';
import { Agenda } from '../core/agenda';
import { IMongoOptions, IPostgresOptions } from '../datasource/interfaces/db-config.interface';
import { isValidMongoConfig, isValidPostgresConfig } from './utils/utils';
import { DataSource } from './enums/data-source.enum';

export function createDbRepository(agenda: Agenda, config: IDataSourceConfig): IJobRepository {
    const dbType = config.dataSource;

    switch (dbType) {
        case DataSource.MONGO:
            if (isValidMongoConfig(config.dataSourceOptions)) {
                return new MongoJobRepository(agenda, config.dataSourceOptions as IMongoOptions);
            }
            break;
        case DataSource.POSTGRES:
            if (isValidPostgresConfig(config.dataSourceOptions)) {
                return new PostgresJobRepository(agenda, config.dataSourceOptions as IPostgresOptions);
            }
            break;
        default:
            throw new Error(`Unsupported database type: ${dbType}`);
    }

    throw new Error(`Invalid configuration for database type: ${dbType}`);
}
