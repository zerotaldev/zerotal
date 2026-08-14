import { LogProvider } from "zerotal/logger";
import { DatabaseProvider } from "zerotal/orm";
import { SessionProvider } from "zerotal/session";
import { AuthProvider } from "zerotal/auth";
import { FlowProvider } from "@zerotal/flow";
import { AiProvider } from "@zerotal/ai";

// Order matters: posts come from the database, the session carries the signed-in
// author across requests, and auth reads it. FlowProvider powers both the
// showcase pages and the authoring UI at /admin; AiProvider backs the streaming
// chat demo at /showcase/flow/ai-chat.
export default [
  LogProvider,
  DatabaseProvider,
  SessionProvider,
  AuthProvider,
  FlowProvider,
  AiProvider,
];
