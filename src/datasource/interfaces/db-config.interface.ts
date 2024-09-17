import type { Db } from 'mongodb';
import { DataSource } from '../enums/data-source.enum';
import type { Pool } from 'pg';

export interface IDataSourceConfig {
	dataSource?: DataSource;
	dataSourceOptions?: IMongoOptions | IPostgresOptions | Record<string, unknown>;
}

export interface IMongoOptions {
	db?: {
		collection?: string;
		address?: string;
	};
	mongo: Db;
}

export interface IPostgresOptions {
	db: {
		user?: string;
		password?: string;
		host?: string;
		port?: number;
		database?: string;
		ssl?: boolean;
		connectionString?: string;
		schema?: string;
		tableName?: string;
	};
	postgres: Pool;
}

export interface IDatabaseOptions {
	ensureIndex?: boolean;
	sort?: {
		[key: string]: 1 | -1 | 'asc' | 'desc' | 'ascending' | 'descending';
	};
}
