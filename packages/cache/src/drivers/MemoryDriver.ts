import type { CacheDriver } from "./CacheDriver.ts";
import { FrameworkEvents } from "@zerotal/core";
import { CacheEvicted } from "../events.ts";

interface Entry {
  value: string;
  expiresAt: number | null;
}

export class MemoryDriver implements CacheDriver {
  private _store = new Map<string, Entry>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _sweepInterval: any;

  /**
   * @param sweepMs - How often to run the background sweep (ms).
   *                  Defaults to 5 minutes. Pass 0 to disable auto-sweeping.
   */
  constructor(sweepMs = 5 * 60 * 1_000) {
    if (sweepMs > 0) {
      this._sweepInterval = setInterval(() => this.sweep(), sweepMs);
    }
  }

  async get(key: string): Promise<string | null> {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this._store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const expiresAt = ttl === undefined ? null : Date.now() + ttl * 1000;
    this._store.set(key, { value, expiresAt });
  }

  async forget(key: string): Promise<void> {
    this._store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const entry = this._store.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this._store.delete(key);
      return false;
    }
    return true;
  }

  async flush(prefix?: string): Promise<void> {
    if (prefix === undefined) {
      this._store.clear();
      return;
    }
    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) this._store.delete(key);
    }
  }

  /**
   * Proactively remove all expired entries from the internal store.
   *
   * Called automatically on the sweep interval. Also callable manually
   * (e.g. before taking a memory snapshot or in tests).
   */
  sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this._store.entries()) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this._store.delete(key);
        FrameworkEvents.emit(new CacheEvicted(key, "ttl"));
      }
    }
  }

  /** Number of entries currently in the store (including expired-but-unswept). */
  get size(): number {
    return this._store.size;
  }

  /** Stop the background sweep interval. Call during graceful shutdown. */
  dispose(): void {
    clearInterval(this._sweepInterval);
  }
}
