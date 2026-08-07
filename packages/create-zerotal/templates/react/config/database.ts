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

  // Builds the schema from the models at boot, so `bun run dev` works with no
  // migration step. Hard-off in production, where you run the migrations in
  // database/migrations instead.
  synchronize: env("APP_ENV", "development") !== "production",
});
