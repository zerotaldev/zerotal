/**
 * Sends that have started and not finished, so a test can wait for them.
 *
 * Mail is usually sent fire-and-forget — `void Notify.send(user, new Welcome())`
 * from a controller or a listener, because the response should not wait on SMTP.
 * A test then asserts before the send has happened, and every app ended up writing
 * its own `settleNotifications()` to sleep until it had. `settle()` is that helper,
 * done once: it waits for every tracked send, then for one more turn of the event
 * loop, and repeats until a turn passes with nothing new — so a send started by
 * code that first awaited something else is waited for too.
 *
 * @internal
 */
export class _InFlight {
  readonly #pending = new Set<Promise<unknown>>();
  #started = 0;

  /**
   * Track `work` until it settles, and hand back a promise the caller can await.
   *
   * The returned promise rejects exactly when `work` does, so a caller that awaits
   * sees the error and one that does not gets the same unhandled rejection it
   * always did — tracking never swallows a failure.
   */
  track<T>(work: Promise<T>): Promise<T> {
    this.#started++;
    const tracked = work.finally(() => {
      this.#pending.delete(tracked);
    });
    this.#pending.add(tracked);
    return tracked;
  }

  /** Something was started since `since` was read. */
  startedSince(since: number): boolean {
    return this.#started !== since;
  }

  /** How many sends have been started, for {@link startedSince}. */
  get started(): number {
    return this.#started;
  }

  /**
   * Resolve once nothing is in flight and a full turn of the event loop has passed
   * without anything new starting. Failed sends do not reject this: the code that
   * started them owns their errors.
   *
   * @param extra - Called after each turn; return `true` when something it watches
   *   changed, to go round again (the fake uses it for captured sends).
   */
  async settle(extra: () => boolean = () => false): Promise<void> {
    for (;;) {
      const before = this.#started;
      while (this.#pending.size > 0) await Promise.allSettled([...this.#pending]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const changed = extra();
      if (this.#pending.size === 0 && !this.startedSince(before) && !changed) return;
    }
  }
}
