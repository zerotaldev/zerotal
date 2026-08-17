import { QueueConfig } from "zerotal/queue";
import type { QueueConfigShape } from "zerotal/queue";
import { env } from "zerotal";

/**
 * The SQLite driver, which provisions its own tables on first use.
 *
 * `workers: 0` keeps job execution out of the web process — jobs are picked up
 * by `bun zt queue:work`. That is deliberate for the cookbook: a job that runs
 * inline proves nothing about the scope-less context feature 6 exists to test.
 */
export default QueueConfig({
  // The cast is not decoration. `env()` returns `string` — it has to, the value
  // comes from the environment — while `driver` is a literal union, so the
  // example in docs/queue.md does not compile as written. See T10.
  driver: env("QUEUE_DRIVER", "sqlite") as QueueConfigShape["driver"],
  pollInterval: env("QUEUE_POLL_INTERVAL", 500),
  // This list is read by the in-process worker pool, *not* by `zt queue:work` —
  // that command takes a single `--queue` and defaults to "default". Since
  // `SendNotificationJob` hardcodes the "notifications" queue, delivering a
  // queued notification needs `zt queue:work --queue=notifications`. See T12.
  queues: ["default", "notifications"],
  workers: env("QUEUE_WORKERS", 0),
});
