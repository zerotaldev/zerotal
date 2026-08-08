import { LogProvider } from "zerotal/logger";
import { DatabaseProvider } from "zerotal/orm";
import { CacheProvider } from "zerotal/cache";
import { SessionProvider } from "zerotal/session";
import { AuthProvider } from "zerotal/auth";
import { FlowProvider } from "@zerotal/flow";
import { AdminProvider } from "@zerotal/admin";
import { DevtoolsProvider } from "@zerotal/devtools";

// Order matters: the database backs every resource, the cache holds the panel's
// navigation-badge counts, and the session underpins auth. FlowProvider is
// listed explicitly (before AdminProvider, which also `dependsOn` it) so its CLI
// tooling boots in `bun zt`, where the admin panel itself does not run.
//
// `DevtoolsProvider` is last and needs no configuration. It activates only when
// APP_ENV is one of development/dev/local/test/testing — it fails *closed*, so
// an unset or `staging` APP_ENV leaves it inert rather than exposing the trace
// inspector. It also injects its own in-page panel, so nothing has to be added
// to the panel's assets. Press Alt+D (Cmd+D on Mac) to open it.
//
// It is a real dependency rather than a devDependency on purpose: this import
// runs in every environment, so a `--production` install that dropped the
// package would fail at boot instead of simply skipping the panel.
const providers = [
  LogProvider,
  DatabaseProvider,
  CacheProvider,
  SessionProvider,
  AuthProvider,
  FlowProvider,
  AdminProvider,
  DevtoolsProvider,
];

export default providers;
