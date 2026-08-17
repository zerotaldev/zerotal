import { LogProvider } from "zerotal/logger";
import { DatabaseProvider } from "zerotal/orm";
import { StorageProvider } from "zerotal/storage";
import { SessionProvider } from "zerotal/session";
import { AuthProvider } from "zerotal/auth";
import { QueueProvider } from "zerotal/queue";
import { NotificationProvider } from "@zerotal/notifications";
import { BroadcastProvider } from "@zerotal/broadcasting";
import { CacheProvider } from "@zerotal/cache";
import { AuditProvider } from "@zerotal/audit";
import { I18nProvider } from "@zerotal/i18n";
import { InertiaProvider } from "@zerotal/inertia";
import { DevtoolsProvider } from "@zerotal/devtools";

// Order matters: the database backs the user model and the session underpins
// auth, so both are registered before AuthProvider boots. AuthProvider installs
// the middleware that puts the signed-in user on the request — which is what
// makes `auth.user` appear in every Inertia page's props.
//
// `DevtoolsProvider` is last and needs no configuration. It activates only when
// APP_ENV is one of development/dev/local/test/testing — it fails *closed*, so
// an unset or `staging` APP_ENV leaves it inert rather than exposing the trace
// inspector. It also injects its own in-page panel, so nothing has to be added
// to the React bundle. Press Alt+D (Cmd+D on Mac) to open it.
//
// It is a real dependency rather than a devDependency on purpose: this import
// runs in every environment, so a `--production` install that dropped the
// package would fail at boot instead of simply skipping the panel.
const providers = [
  LogProvider,
  DatabaseProvider,
  StorageProvider,
  // Early: the catalogs must be loaded before the first request resolves a
  // locale, and a queue job renders a notification without any request at all.
  I18nProvider,
  // Before anything that reads it. The dashboard's aggregates are cached, and a
  // cache miss is only a slower answer — but an unbound `Cache` facade is an
  // exception on a page that would otherwise work.
  CacheProvider,
  SessionProvider,
  AuthProvider,
  // Queue before notifications: `Notify.queue()` pushes onto the queue the
  // former binds, and notifications' database channel needs the ORM above.
  QueueProvider,
  NotificationProvider,
  // After Auth: the trail records *who* made each change, which it reads from
  // the authenticated user. Registered before the routes that mutate anything.
  AuditProvider,
  // After Auth: channel authorization reads the signed-in user off the request,
  // and `routes/channels.ts` queries models, so both must already be bound when
  // the first subscribe arrives.
  BroadcastProvider,
  InertiaProvider,
  DevtoolsProvider,
];

export default providers;
