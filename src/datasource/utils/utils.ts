import { IMongoOptions, IPostgresOptions } from "../interfaces/db-config.interface";

export const hasMongoProtocol = (url: string): boolean => /mongodb(?:\+srv)?:\/\/.*/.test(url);

export const isValidMongoConfig = (config: any): config is IMongoOptions => {
    return (
        ('mongo' in config && typeof config.mongo === 'object') ||
        ('db' in config && typeof config.db === 'object' && 'address' in config.db)
    );
}

export const isValidPostgresConfig = (config: any): config is IPostgresOptions => {
    return (
        ('postgres' in config && typeof config.postgres === 'object') ||
        (
            'db' in config &&
            typeof config.db === 'object' &&
            (
                ('connectionString' in config.db && typeof config.db.connectionString === 'string') ||
                (
                    'host' in config.db &&
                    'port' in config.db &&
                    'database' in config.db &&
                    'user' in config.db &&
                    'password' in config.db
                )
            )
        )
    );
}