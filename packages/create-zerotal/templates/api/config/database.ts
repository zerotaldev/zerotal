import { env } from 'zerotal';
import { DatabaseConfig } from 'zerotal/orm';

export default DatabaseConfig({
  // The driver has to agree with the URL's protocol. Boot validation rejects a
  // sqlite driver pointed at postgres:// or mysql://, which is exactly what you
  // get if this is left to its default while DATABASE_URL names a network
  // database — so it is stamped from the database you chose when scaffolding.
  driver: '{{db_driver}}',

  // ZT_DB_URL first: `bun zt test` sets it (defaults to :memory:) and that
  // override has to beat the DATABASE_URL in .env, or the suite would run
  // against your development database and leave its rows behind.
  url: env('ZT_DB_URL', env('DATABASE_URL', '{{db_url}}')),
});
