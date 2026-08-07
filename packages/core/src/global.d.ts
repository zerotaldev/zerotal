// Ambient declarations specific to this codebase.
//
// Bun, Node (`node:*`), and `bun:test` types come from `@types/bun` (→ bun-types).
// Only declarations that bun-types does NOT provide live here.

// Bun extends Request with route params (e.g. /users/:id → { id: '42' }).
interface Request {
  readonly params?: Record<string, string>;
}
