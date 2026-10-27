import { describe, it, expect } from "bun:test";
import { QueueManager, type QueueDriver, type JobRecord } from "@zerotal/queue";
import { Notification } from "./Notification.ts";
import { SendNotificationJob } from "./SendNotificationJob.ts";
import { OnDemandNotifiable } from "./index.ts";

/**
 * A queued notification always got three attempts, one second apart, and nothing could change
 * that: `SendNotificationJob` took the queue's defaults and `Notification` had nowhere to say
 * otherwise. The failures worth retrying for mail (a host restarting, a provider's bad few
 * minutes) outlast three seconds, so the notification ended up in the failed-jobs table, and an
 * app that queued its mail subclassed the framework's own job to fix it.
 */
class Plain extends Notification {
  channels(): string[] {
    return ["mail"];
  }
}

class PaymentDue extends Notification {
  override tries = 8;
  override backoff = 5 * 60_000;
  channels(): string[] {
    return ["mail"];
  }
}

const to = () => new OnDemandNotifiable({ mail: "ada@example.test" });

describe("a queued notification's retry policy", () => {
  it("is the queue's default when the notification says nothing", () => {
    const job = new SendNotificationJob(to(), new Plain());

    expect([job.maxAttempts, job.retryDelay]).toEqual([3, 1000]);
  });

  it("is the notification's when it says", () => {
    const job = new SendNotificationJob(to(), new PaymentDue());

    expect([job.maxAttempts, job.retryDelay]).toEqual([8, 300_000]);
  });

  it("survives being stored and rebuilt, as the worker and queue:retry rebuild it", () => {
    const stored = new SendNotificationJob(to(), new PaymentDue()).payload();

    const rebuilt = SendNotificationJob.fromPayload(JSON.parse(JSON.stringify(stored)));

    expect([rebuilt.maxAttempts, rebuilt.retryDelay]).toEqual([8, 300_000]);
  });

  it("adds nothing to the stored payload for a notification that sets nothing", () => {
    expect(new SendNotificationJob(to(), new Plain()).payload()).not.toHaveProperty("retry");
  });

  it("is what the queue records when the job is dispatched", async () => {
    const records: JobRecord[] = [];
    const driver = {
      push: async (record: JobRecord) => {
        records.push(record);
      },
    } as unknown as QueueDriver;

    await new QueueManager(driver).dispatch(new SendNotificationJob(to(), new PaymentDue()));

    expect(records[0]).toMatchObject({ maxAttempts: 8, retryDelay: 300_000 });
  });

  it("refuses a nonsense value where it was written, rather than queueing it", () => {
    class Zero extends Plain {
      override tries = 0;
    }
    class Negative extends Plain {
      override backoff = -5;
    }

    expect(() => new SendNotificationJob(to(), new Zero())).toThrow(/Zero\.tries/);
    expect(() => new SendNotificationJob(to(), new Negative())).toThrow(/Negative\.backoff/);
  });
});
