// Ambient declarations specific to this package.
// Bun, Node (node:*), and bun:test types come from @types/bun (→ bun-types).
// Only declarations bun-types does NOT provide are kept here.

// ── Bun globals ───────────────────────────────────────────────────────────
interface Request {
  readonly params?: Record<string, string>;
}

// ── SQLInstance ───────────────────────────────────────────────────────────
interface SQLInstance {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  begin<T>(fn: (tx: SQLInstance) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

interface RedisInstance {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  set(key: string, value: string, options: { ex: number }): Promise<void>;
  lpush(key: string, value: string): Promise<number>;
  rpop(key: string): Promise<string | null>;
  llen(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  flushdb(): Promise<void>;
}
