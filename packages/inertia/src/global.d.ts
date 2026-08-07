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

// ── React type stubs ──────────────────────────────────────────────────────
declare module 'react' {
  export function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown;
  export const version: string;
}

declare module 'react-dom/client' {
  export function createRoot(container: Element | null): { render(el: unknown): void };
}

declare module 'react-dom/server' {
  /** Render a React element to an HTML string (SSR). */
  export function renderToString(element: unknown): string;
  /** Render a React element to a static HTML string (no data-react attributes). */
  export function renderToStaticMarkup(element: unknown): string;
  /** Render a React element to a streaming ReadableStream (React 18+). */
  export function renderToReadableStream(
    element: unknown,
    options?: {
      signal?: AbortSignal;
      onError?: (error: unknown) => void;
    },
  ): Promise<ReadableStream<Uint8Array>>;
}

// ── @inertiajs/react type stub ────────────────────────────────────────────
declare module '@inertiajs/react' {
  export function createInertiaApp(options: {
    resolve: (name: string) => unknown | Promise<unknown>;
    setup:   (args: { el: Element; App: unknown; props: unknown }) => void;
  }): Promise<void>;

  export function usePage<T = Record<string, unknown>>(): { props: T };
  export function Link(props: { href: string; children?: unknown }): unknown;
  export const router: {
    visit(url: string): void;
    post(url: string, data?: unknown): void;
    put(url: string, data?: unknown): void;
    delete(url: string): void;
  };
  export function useForm<T extends Record<string, unknown>>(initial: T): {
    data:       T;
    errors:     Partial<Record<keyof T, string>>;
    processing: boolean;
    setData(key: keyof T, value: unknown): void;
    post(url: string): void;
    put(url: string): void;
    delete(url: string): void;
    reset(): void;
  };
}
