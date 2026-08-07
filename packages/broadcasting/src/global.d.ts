// Ambient declarations specific to this package.
// Bun, Node (node:*), and bun:test types come from @types/bun (→ bun-types).
// Only declarations bun-types does NOT provide are kept here.

interface ServerWebSocket<T = unknown> {
  readonly data: T;
  send(message: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  readyState: number;
}
