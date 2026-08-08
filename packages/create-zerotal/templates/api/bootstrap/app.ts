import { Application } from 'zerotal';
import { DatabaseProvider } from 'zerotal/orm';
import { SessionProvider } from 'zerotal/session';
import { AuthProvider } from 'zerotal/auth';
import { NotificationProvider } from '@zerotal/notifications';
import { QueueProvider } from 'zerotal/queue';
import { LogProvider } from 'zerotal/logger';
import { DevtoolsProvider } from '@zerotal/devtools';

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
    DevtoolsProvider,
  ],
})
  .routing({ web: `${import.meta.dir}/../routes/index.ts` });
