import { describe, it, expect, afterEach } from "bun:test";
import { MonitorPage } from "./MonitorPage.tsx";
import { MonitorStore } from "../MonitorStore.ts";
import { _setStore } from "../instance.ts";

const REFUSED = 'Cannot retry failed job 2: "Unregistered" is not a registered job class.';

/** A store over a queue that takes job 1 back and refuses job 2's unregistered class. */
function storeOverQueue(): MonitorStore {
  const rows = [
    { id: 1, className: "SendInvoice" },
    { id: 2, className: "Unregistered" },
  ].map((r) => ({
    ...r,
    queue: "default",
    attempts: 3,
    maxAttempts: 3,
    error: "boom",
    failedAt: "",
  }));
  const queue = {
    queues: async () => [],
    failed: async () => [...rows],
    retryFailed: async (id: number) => {
      const index = rows.findIndex((r) => r.id === id);
      if (index === -1) return false;
      if (rows[index]!.className === "Unregistered") throw new Error(REFUSED);
      rows.splice(index, 1);
      return true;
    },
  };
  const store = new MonitorStore({ storage: ":memory:" });
  store.bindApp({ container: { tryMake: (n: string) => (n === "queue" ? queue : null) } } as never);
  return store;
}

/** The toasts an action queued, as the client would receive them. */
function flashes(page: MonitorPage): { message: string; level: unknown }[] {
  return page._flashes.map(({ message, level }) => ({ message, level }));
}

describe("MonitorPage retry buttons", () => {
  let store: MonitorStore | undefined;
  afterEach(() => {
    _setStore(undefined);
    store?.dispose();
    store = undefined;
  });

  it("says the job was re-queued when the queue took it back", async () => {
    store = storeOverQueue();
    _setStore(store);
    const page = new MonitorPage();

    await page.retryJob(1);
    expect(flashes(page)).toEqual([{ message: "Job re-queued for retry.", level: "success" }]);
    expect(page.snap?.failedJobs.map((j) => j.id)).toEqual([2]);
  });

  it("shows the queue's reason and keeps the row when the retry was refused", async () => {
    // A success toast over a job that was still failed, with its row hidden until a reload.
    store = storeOverQueue();
    _setStore(store);
    const page = new MonitorPage();

    await page.retryJob(2);
    await page.requeueDead(2);
    expect(flashes(page)).toEqual([
      { message: `Job #2 was not retried: ${REFUSED}`, level: "error" },
      { message: `Job #2 was not retried: ${REFUSED}`, level: "error" },
    ]);
    expect(page.snap?.failedJobs.map((j) => j.id)).toEqual([1, 2]);
    expect(page.snap?.deadLetter.map((d) => d.id)).toEqual([1, 2]);
  });
});
