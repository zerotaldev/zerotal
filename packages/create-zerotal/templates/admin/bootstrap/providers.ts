import { LogProvider } from "zerotal/logger";
import { DatabaseProvider } from "zerotal/orm";
import { CacheProvider } from "zerotal/cache";
import { SessionProvider } from "zerotal/session";
import { AuthProvider } from "zerotal/auth";
import { FlowProvider } from "@zerotal/flow";
import { AdminProvider } from "@zerotal/admin";

// Order matters: the database backs every resource, the cache holds the panel's
// navigation-badge counts, and the session underpins auth. FlowProvider is
// listed explicitly (before AdminProvider, which also `dependsOn` it) so its CLI
// tooling boots in `bun zt`, where the admin panel itself does not run.
const providers = [
  LogProvider,
  DatabaseProvider,
  CacheProvider,
  SessionProvider,
  AuthProvider,
  FlowProvider,
  AdminProvider,
];

export default providers;
