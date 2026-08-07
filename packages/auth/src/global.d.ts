// Ambient declarations specific to this package.
// Bun, Node (node:*), and bun:test types come from @types/bun (→ bun-types).
// Only declarations bun-types does NOT provide are kept here.

// Bun extends Request with native route params (e.g. /users/:id → { id: '42' })
interface Request {
  readonly params?: Record<string, string>;
}

// Bun extends Request with .cookies
interface Request {
  readonly cookies: Bun.CookieMap;
}
