// Ambient declarations specific to this package.
// Bun, Node (node:*), and bun:test types come from @types/bun (→ bun-types).
// Only declarations bun-types does NOT provide are kept here.

// Bun extends Request with native route params (e.g. /users/:id → { id: '42' })
interface Request {
  readonly params?: Record<string, string>;
}

// Ambient mirror of the exported SQLInstance (see ./db/sql-types.ts) so test files
// that reference it without an import still resolve. Source files import the exported
// type, which shadows this within those modules.
interface SQLInstance {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  begin<T>(fn: (tx: SQLInstance) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}
