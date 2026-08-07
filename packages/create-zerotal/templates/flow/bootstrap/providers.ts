import { LogProvider } from "zerotal/logger";
import { DatabaseProvider } from "zerotal/orm";
import { SessionProvider } from "zerotal/session";
import { AuthProvider } from "zerotal/auth";
import { FlowProvider } from "@zerotal/flow";

// Order matters: the database backs the user model, and the session underpins
// auth — AuthProvider needs both already registered when it boots.
const providers = [LogProvider, DatabaseProvider, SessionProvider, AuthProvider, FlowProvider];

export default providers;
