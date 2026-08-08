import { Application, basePath } from 'zerotal';
import { LogProvider } from 'zerotal/logger';
import { DevtoolsProvider } from '@zerotal/devtools';

// `DevtoolsProvider` needs no configuration. It activates only when APP_ENV is
// one of development/dev/local/test/testing — it fails *closed*, so an unset or
// `staging` APP_ENV leaves it inert rather than exposing the trace inspector. It
// injects its own in-page panel, so nothing has to be added to the frontend
// bundle. Press Alt+D (Cmd+D on Mac) to open it.
//
// It is a real dependency rather than a devDependency on purpose: this import
// runs in every environment, so a `--production` install that dropped the
// package would fail at boot instead of simply skipping the panel.
const app = Application.create({ providers: [LogProvider, DevtoolsProvider] })
  .routing({
    web: basePath("routes/index.ts"),
  });

export default app;