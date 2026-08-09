import { LogProvider } from "zerotal/logger";
import { DatabaseProvider } from "zerotal/orm";
import { StorageProvider } from "zerotal/storage";
import { SessionProvider } from "zerotal/session";
import { AuthProvider } from "zerotal/auth";
import { InertiaProvider } from "@zerotal/inertia";

// Order matters: the database backs the user model and the session underpins
// auth, so both are registered before AuthProvider boots. AuthProvider installs
// the middleware that puts the signed-in user on the request — which is what
// makes `auth.user` appear in every Inertia page's props.
const providers = [LogProvider, DatabaseProvider, SessionProvider, AuthProvider, InertiaProvider];

export default providers;
