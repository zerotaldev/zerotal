import { DatabaseDriver } from "./DatabaseDriver.ts";

/**
 * The database queue driver under the name it had before it ran on PostgreSQL
 * and MySQL. It is the same class: `driver: "sqlite"` in `config/queue.ts` and
 * `new SqliteDriver(sql)` keep working, on whichever engine the connection is.
 * New code can say {@link DatabaseDriver}.
 */
export class SqliteDriver extends DatabaseDriver {}
