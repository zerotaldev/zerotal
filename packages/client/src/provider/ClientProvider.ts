import { ServiceProvider, createFacade } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import { ApiClient } from "../ApiClient.ts";
import type { ClientConfigShape } from "../config.ts";
import "../augment.ts";

export class ClientProvider extends ServiceProvider {
  static override provides = ["client"] as const;
  static override environments: AppEnvironment[] = ["web", "console", "worker", "test", "repl"];

  override onRegister(): void {
    this.app.container.singleton("client", async (c) => {
      const cfg = (await c.make("config")) as { get<T>(path: string): T | undefined };
      const options: ClientConfigShape = cfg.get<ClientConfigShape>("client") ?? {};
      return new ApiClient(options);
    });
  }

  // Pre-resolve the async singleton so the `Client` facade's makeSync access
  // works after boot (an async factory needs one `await make()` first).
  override async onBooted(): Promise<void> {
    await this.app.container.make("client");
  }
}

export const Client = createFacade<"client">("client");
