import { env } from "zerotal";
import { DatabaseConfig } from "zerotal/orm";

export default DatabaseConfig({
  driver: "sqlite",
  url: env("DATABASE_URL", env("ZT_DB_URL", "./database/db.sqlite")),

  // The site's content lives in this database, so the schema has to exist before
  // the first request. Additive sync builds it from the models at boot — no
  // migration step between cloning the repo and writing a post. Off in
  // production, where `zt migrate` runs generated migrations instead.
  synchronize: env("APP_ENV", "local") !== "production",
});
