import type { ApiClient } from "./ApiClient.ts";
import type { ApiRouteMap } from "./types.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    client: ApiClient<ApiRouteMap>;
  }
}
