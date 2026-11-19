import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { assertBusinessTimezone, installPgTimeParsers } from './pg-time';
import { installDrizzleTimeMappers } from './drizzle-time';

// Must precede the first query. `pg`'s type parsers are module-global, so this
// one call also covers the vector pool and any script that imports either.
installPgTimeParsers();
assertBusinessTimezone();

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL or POSTGRES_URL environment variable is not set');
}

const pool = new Pool({
  connectionString: databaseUrl,
});

// The driver-level pin above does NOT cover Drizzle: it overrides pg's type
// parsers per query and maps timestamps itself, declaring naive WIB wall-clock
// to be UTC on read and writing UTC wall-clock on insert. See drizzle-time.ts.
installDrizzleTimeMappers(schema);

export const db = drizzle(pool, { schema });
export { pool };
