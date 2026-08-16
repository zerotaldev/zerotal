import { LogProvider } from "zerotal/logger";
import { DatabaseProvider } from "zerotal/orm";
import { SessionProvider } from "zerotal/session";
import { AuthProvider } from "zerotal/auth";
import { FlowProvider } from "@zerotal/flow";
import { AiProvider } from "@zerotal/ai";
import { ArchProvider } from "@zerotal/arch";
import { DevtoolsProvider } from "@zerotal/devtools";

// Order matters: posts come from the database, the session carries the signed-in
// author across requests, and auth reads it. FlowProvider powers both the
// showcase pages and the authoring UI at /admin; AiProvider backs the streaming
// chat demo at /showcase/flow/ai-chat. ArchProvider is console-only — it adds the
// agent-surface commands and contributes nothing to a request.
export default [
  LogProvider,
  DatabaseProvider,
  SessionProvider,
  AuthProvider,
  FlowProvider,
  AiProvider,
  ArchProvider,
  // Web-only and short-circuited in production; it registers its own injection
  // middleware, so nothing goes in `.use([…])`.
  DevtoolsProvider,
];
