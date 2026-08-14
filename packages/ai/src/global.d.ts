// Ambient declarations specific to this package.
// Bun, Node (node:*), and bun:test types come from @types/bun (→ bun-types).
// Only declarations bun-types does NOT provide are kept here.

// ── Bun globals ───────────────────────────────────────────────────────────
interface Request {
  readonly params?: Record<string, string>;
}
