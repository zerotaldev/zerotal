// ── @zerotal/flow/jsx-dev-runtime ────────────────────────────────────────────────
//
// The dev-mode JSX entry the toolchain resolves to for non-production `.tsx` builds
// (`jsxImportSource: "@zerotal/flow"`). It simply re-exports the same factories as
// `jsx-runtime`, adding the `jsxDEV` alias Bun/TS emit in development. Compiler-facing —
// application code imports neither directly.

export { jsx, jsxs, Fragment, renderToString } from "./jsx-runtime.ts";
/**
 * Dev-mode element factory Bun/TypeScript emit in non-production builds; aliased to `jsx`.
 * @internal
 */
export { jsx as jsxDEV } from "./jsx-runtime.ts";
export type { HtmlNode } from "./jsx-runtime.ts";
