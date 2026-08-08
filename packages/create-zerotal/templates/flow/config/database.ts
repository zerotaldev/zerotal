import { env } from "zerotal";
import { DatabaseConfig } from "zerotal/orm";

export default DatabaseConfig({
  // The driver has to agree with the URL's protocol — boot validation rejects a
  // sqlite driver pointed at postgres:// or mysql://. Change both together.
  driver: "sqlite",

  // ZT_DB_URL first: `bun zt test` sets it (defaults to :memory:) and that
  // override has to beat the DATABASE_URL in .env, or the suite would run
  // against your development database and leave its rows behind.
  url: env("ZT_DB_URL", env("DATABASE_URL", "./database/db.sqlite")),

  // Off deliberately. This template ships baseline migrations in
  // database/migrations, and boot-time schema sync would create the same tables
  // from the models first — so the very first `bun zt migrate` would fail with
  // "table users already exists". Migrations are the single source of truth, in
  // development exactly as in production; run `bun zt migrate` after scaffolding.
  synchronize: false,
});
