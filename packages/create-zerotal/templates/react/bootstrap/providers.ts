import { LogProvider } from "zerotal/logger";
import { DatabaseProvider } from "zerotal/orm";
import { SessionProvider } from "zerotal/session";
import { AuthProvider } from "zerotal/auth";
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
  SessionProvider,
  AuthProvider,
  InertiaProvider,
  DevtoolsProvider,
];

export default providers;
