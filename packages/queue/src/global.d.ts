// Ambient declarations specific to this package.
// Bun, Node (node:*), and bun:test types come from @types/bun (→ bun-types).
// Only declarations bun-types does NOT provide are kept here.

// ── Bun globals ───────────────────────────────────────────────────────────
// Bun extends Request with native route params (e.g. /users/:id → { id: '42' })
interface Request {
  readonly params?: Record<string, string>;
}

// ── SQLInstance: callable tagged-template + DB methods ────────────────────
interface SQLInstance {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  begin<T>(fn: (tx: SQLInstance) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

// ── RedisInstance: minimal Bun.redis surface ──────────────────────────────
interface RedisInstance {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  set(key: string, value: string, options: { ex: number }): Promise<void>;
  lpush(key: string, value: string): Promise<number>;
  rpop(key: string): Promise<string | null>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  llen(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  flushdb(): Promise<void>;
}
