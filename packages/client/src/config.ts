import { deepMerge } from "@zerotal/core/helpers";
import type { ApiClientConfig } from "./ApiClient.ts";

export interface ClientConfigShape extends ApiClientConfig {
  baseUrl?: string;
}

// The client carries no framework-level defaults of its own — `ApiClient` applies
// its own internal defaults. deepMerge still gives a fresh, isolated copy of the
// caller's options (and keeps every config factory on the one canonical merge).
const defaults: Partial<ClientConfigShape> = {};

export function ClientConfig(options: Partial<ClientConfigShape> = {}): Partial<ClientConfigShape> {
  return deepMerge(defaults, options);
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    client: ClientConfigShape;
  }
}
