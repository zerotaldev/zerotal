/**
 * Bun Worker thread script — runs in a separate OS thread.
 *
 * Protocol (messages from parent → worker):
 *   { type: 'bootstrap', modulePath: string }
 *     Dynamically import the module at `modulePath`. That module must register
 *     all job classes via JobRegistry.register(). Replies { type: 'ready' } on
 *     success or { type: 'bootstrap-error', message } on failure.
 *
 *   { type: 'job', record: JobRecord }
 *     Instantiate and handle the job described by `record`. Replies
 *     { type: 'done' } on success or { type: 'error', message } on failure.
 *     The parent thread is responsible for delete / retry / fail storage ops.
 */

import { JobRegistry } from "./JobRegistry.ts";
import type { JobRecord } from "./drivers/QueueDriver.ts";
import type { Job } from "./Job.ts";

let bootstrapped = false;

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data as { type: string } & Record<string, unknown>;

  if (msg.type === "bootstrap") {
    try {
      const modulePath = msg.modulePath as string | undefined;
      if (modulePath) {
        // Explicit bootstrap module (config: queue.workerBootstrap) — it must
        // import/register every job class.
        await import(modulePath);
      } else {
        // Convention: import every app/jobs/*.ts so each self-registers via
        // JobRegistry.register(). Mirrors the `jobs` convention concern, run here
        // because this bare worker thread does not boot a full Application.
        // app/notifications/ comes along for the same reason: a queued
        // notification names its class, and the class must have been imported
        // here for SendNotificationJob to rebuild it.
        const glob = new Bun.Glob("*.ts");
        for (const dir of ["app/jobs", "app/notifications"]) {
          try {
            for await (const file of glob.scan({
              cwd: `${process.cwd()}/${dir}`,
              absolute: true,
            })) {
              await import(`file://${file.replace(/\\/g, "/")}`);
            }
          } catch {
            /* directory doesn't exist — nothing to register */
          }
        }
      }
      bootstrapped = true;
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "bootstrap-error", message: String(err) });
    }
    return;
  }

  if (msg.type === "job") {
    if (!bootstrapped) {
      self.postMessage({ type: "error", message: "Worker is not bootstrapped yet" });
      return;
    }

    const record = msg.record as JobRecord;
    try {
      const JobClass = JobRegistry.resolve(record.className);
      if (!JobClass) {
        self.postMessage({ type: "error", message: `Unknown job class: ${record.className}` });
        return;
      }

      const payload = JSON.parse(record.payload) as Record<string, unknown>;
      let instance: Job;

      if (
        "fromPayload" in JobClass &&
        typeof (JobClass as Record<string, unknown>).fromPayload === "function"
      ) {
        instance = (JobClass as { fromPayload(p: Record<string, unknown>): Job }).fromPayload(
          payload,
        );
      } else {
        instance = new (JobClass as new () => Job)();
      }

      await instance.handle();
      self.postMessage({ type: "done" });
    } catch (err) {
      self.postMessage({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
