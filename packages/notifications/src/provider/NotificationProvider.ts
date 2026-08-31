import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { NotificationManager } from "../NotificationManager.ts";
import { NotificationConfig } from "../config.ts";
import { installNotificationsObservability } from "../observability.ts";
import { installNotificationStats } from "../stats.ts";
import { installNotificationsAdmin } from "../admin.ts";
import { mailDriverCheck } from "../doctor.ts";
import { notificationsTableCheck } from "../tableDoctor.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    notifications: NotificationManager;
  }
}

export class NotificationProvider extends ServiceProvider {
  static override provides = ["notifications"] as const;
  static override environments: AppEnvironment[] = ["web", "console", "worker", "test"];

  private _disposeObservability: (() => void) | undefined = undefined;
  private _disposeStats: (() => void) | undefined = undefined;

  override onRegister(): void {
    this.app.container.singleton("notifications", () => {
      const config = this.app.container.makeSync("config") as ConfigManager;
      const cfg = config.get<ReturnType<typeof NotificationConfig>>(
        "notifications",
        NotificationConfig(),
      );
      return new NotificationManager(cfg);
    });
  }

  override async onBooting(): Promise<void> {
    // The admin panel binds its contribution surface during registration, so the
    // booting phase reaches it regardless of provider order.
    installNotificationsAdmin(this.app);

    // `zt doctor`, and through it `zt deploy`: mail going to a log file in
    // production is the quietest failure this package has.
    this.app.registerDoctorCheck?.(mailDriverCheck);
    this.app.registerDoctorCheck?.(notificationsTableCheck);
  }

  override async onBooted(): Promise<void> {
    await this.app.container.make("notifications");
    this._disposeObservability = installNotificationsObservability(this.app);
    this._disposeStats = installNotificationStats();

    const runner = this.app.container.tryMake("commands");
    if (!runner) return;

    runner.registerLazy("notifications:prune", () =>
      import("../commands/NotificationsPruneCommand.ts").then((m) => m.NotificationsPruneCommand),
    );
    runner.registerLazy("notifications:test", () =>
      import("../commands/NotificationsTestCommand.ts").then((m) => m.NotificationsTestCommand),
    );
  }

  override async onStopping(): Promise<void> {
    this._disposeObservability?.();
    this._disposeObservability = undefined;
    this._disposeStats?.();
    this._disposeStats = undefined;
  }
}
