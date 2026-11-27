import { Application } from 'zerotal';
import { DatabaseProvider } from 'zerotal/orm';
import { SessionProvider } from 'zerotal/session';
import { AuthProvider } from 'zerotal/auth';
import { NotificationProvider } from '@zerotal/notifications';
import { QueueProvider } from 'zerotal/queue';
import { LogProvider } from 'zerotal/logger';
import { StorageProvider } from 'zerotal/storage';
import { DevtoolsProvider } from '@zerotal/devtools';
import type { User } from '../app/models/User.ts';

// Tell @zerotal/auth which model `Auth.user()` and `http.user` are. The empty body is
// the point: this augmentation exists to bind the type, not to add members.
declare module 'zerotal/auth' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface UserModel extends User {}
}

// `DevtoolsProvider` needs no configuration. It activates only when APP_ENV is
// one of development/dev/local/test/testing — it fails *closed*, so an unset or
// `staging` APP_ENV leaves it inert rather than exposing the trace inspector.
//
// This API answers with JSON, so there is no HTML for the floating panel to
// attach itself to. Open `http://localhost:3000/__zerotal/devtools` instead —
// the dashboard is served as its own page, and every request this API handles
// still records its SQL, N+1 warnings, jobs, mail and logs there.
//
// It is a real dependency rather than a devDependency on purpose: this import
// runs in every environment, so a `--production` install that dropped the
// package would fail at boot instead of simply skipping the panel.
export default Application.create({
  providers: [
    DatabaseProvider,
    SessionProvider,
    AuthProvider,
    NotificationProvider,
    QueueProvider,
    LogProvider,
    // Registered up front because its absence is invisible until the first
    // upload. A `Storage.disk(...)` call usually sits behind auth, a permission
    // check and a multipart parse, so every simpler probe returns 401/403 long
    // before reaching the line that would fail — and the line that would fail
    // is usually first reached in production. It costs nothing when unused.
    StorageProvider,
    DevtoolsProvider,
  ],
})
  .routing({ web: `${import.meta.dir}/../routes/index.ts` });
