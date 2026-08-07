// Ambient declarations specific to this package.
// Bun, Node (node:*), and bun:test types come from @types/bun (→ bun-types).
// Only declarations bun-types does NOT provide are kept here.

// ── Bun globals ───────────────────────────────────────────────────────────────
interface Request {
  readonly params?: Record<string, string>;
  readonly cookies: Bun.CookieMap;
}

// ── SQLInstance ───────────────────────────────────────────────────────────────
interface SQLInstance {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  begin<T>(fn: (tx: SQLInstance) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}
