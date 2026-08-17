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
import { FlowProvider } from "@zerotal/flow";
import { DevtoolsProvider } from "@zerotal/devtools";

// The same set the other two builds register, in the same order, with `FlowProvider`
// standing where `InertiaProvider` stands in one and nothing stands in the other.
// That is the cookbook's claim in one file: the render layer is the variable, and
// everything under it is held constant.
//
// Order matters: the database backs the user model and the session underpins auth,
// so both are registered before AuthProvider boots.
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
  // the authenticated user.
  AuditProvider,
  // After Auth: channel authorization reads the signed-in user off the request.
  BroadcastProvider,
  // After Session and Auth, because Flow re-runs those middleware on every
  // WebSocket frame — a socket update has to know who is on the other end.
  FlowProvider,
  DevtoolsProvider,
];

export default providers;
