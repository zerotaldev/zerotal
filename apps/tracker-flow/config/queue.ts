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
  // Read by the in-process worker pool *and* by `zt queue:work`, which drains
  // every queue named here when no `--queue` is given. `SendNotificationJob`
  // pins itself to "notifications", so listing it is what makes a queued
  // notification arrive — `zt queue:work` on its own is enough. It was not:
  // the command used to listen on "default" alone and the mail was queued and
  // never sent. See T12.
  queues: ["default", "notifications"],
  workers: env("QUEUE_WORKERS", 0),
});
