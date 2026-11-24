import { LogProvider } from "zerotal/logger";
import { DatabaseProvider } from "zerotal/orm";
import { StorageProvider } from "zerotal/storage";
import { SessionProvider } from "zerotal/session";
import { AuthProvider, SocialProvider } from "zerotal/auth";
import { NotificationProvider } from "@zerotal/notifications";
import { FlowProvider } from "@zerotal/flow";
import { DevtoolsProvider } from "@zerotal/devtools";

// Order matters: the database backs the user model and the session underpins
// auth, so both are registered before AuthProvider boots. AuthProvider installs
// the middleware that puts the signed-in user on the request, which is where the
// pages and layouts read it from.
//
// NotificationProvider delivers mail: the email-verification and password-reset
// links. config/notifications.ts picks the driver, and the default writes each
// message to the log, so a new app has working links before it has a mail server.
//
// SocialProvider reads config/social.ts, which only lists GitHub and Google once
// their keys are set in .env — until then there is nothing for it to register.
//
// FlowProvider serves the pages in app/flow/pages/ and builds resources/ in
// development. Your own providers live in app/providers/ and are registered
// without being listed here.
//
// `DevtoolsProvider` is last and needs no configuration. It activates only when
// APP_ENV is one of development/dev/local/test/testing — it fails *closed*, so
// an unset or `staging` APP_ENV leaves it inert rather than exposing the trace
// inspector. It also injects its own in-page panel, so nothing has to be added
// to the frontend bundle. Press Alt+D (Cmd+D on Mac) to open it.
//
// It is a real dependency rather than a devDependency on purpose: this import
// runs in every environment, so a `--production` install that dropped the
// package would fail at boot instead of simply skipping the panel.
const providers = [
  LogProvider,
  DatabaseProvider,
  StorageProvider,
  SessionProvider,
  AuthProvider,
  NotificationProvider,
  SocialProvider,
  FlowProvider,
  DevtoolsProvider,
];

export default providers;
