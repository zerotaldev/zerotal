/**
 * Loading a package that only some apps install.
 *
 * A feature that most apps never use should not put its dependency into every app.
 * The package declares it as an optional peer, and loads it at the moment the
 * feature is used — which means the load can fail, and has to fail in a way that
 * says what to do. This module is that failure.
 *
 * The call site is one expression, and every part of it is load-bearing:
 *
 * ```ts
 * const sharp: SharpModule = await import("sharp" as string).catch(
 *   optionalPeer("sharp", { feature: 'driver: "sharp"', alternative: 'driver: "bun"' }),
 * );
 * ```
 *
 * - **The specifier is a literal.** `bun build --compile` embeds a package only when
 *   it can see the name; `const s = "sharp"; import(s)` builds a binary without it.
 * - **`.catch()` is attached to the import itself.** The bundler accepts an import it
 *   cannot resolve only when the failure is visibly handled there (a `.catch`, or a
 *   surrounding `try`). Hand `() => import("sharp")` to a helper instead and every
 *   compiled app without `sharp` stops building.
 * - **`as string` stops TypeScript resolving it.** Packages ship TypeScript, so an
 *   app's `tsc` checks this line too, and fails on a package the app never installed.
 *   Bun strips the assertion, so the bundler still sees the literal. The module comes
 *   back as `any`: describe the part you use with your own type rather than importing
 *   the peer's.
 *
 * @module
 */
import { OptionalPeerMissingError } from "../errors/OptionalPeerMissingError.ts";

/** What to tell someone whose app is missing an optional peer. */
export interface OptionalPeerHint {
  /**
   * What the app asked for that needs the package, in the words the app used —
   * a config value, a method, a driver name. Completes "… needs the optional
   * package …", e.g. `'config/media.ts driver: "sharp"'`.
   */
  feature: string;
  /** The command that installs it. Defaults to `bun add <package>`. */
  install?: string | undefined;
  /** What to do instead, when the feature has a built-in alternative. */
  alternative?: string | undefined;
}

/**
 * The package a specifier names: `@scope/name` or `name`, without any subpath.
 *
 * @param spec - An import specifier such as `react-dom/server`.
 */
function packageName(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? spec);
}

/**
 * Whether `error` says that `spec` itself could not be found.
 *
 * Decided on `code` and `specifier`, never the message: the wording differs between
 * Bun releases, and a match on "Cannot find" would also catch an installed peer
 * that is missing one of *its own* dependencies — a broken install, which must be
 * reported as itself and not as "install the package you already have". Bun puts
 * the unresolved name in `specifier`, so that case names a different package.
 */
function isMissing(error: unknown, spec: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, specifier } = error as { code?: unknown; specifier?: unknown };
  return (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") && specifier === spec;
}

/**
 * The handler for loading an optional peer: attach it to the import with `.catch()`.
 *
 * When the import failed because `spec` is not installed, it throws an
 * {@link OptionalPeerMissingError} that names the feature, the install command and
 * the alternative, with the original error as `cause`. Every other failure — the
 * package threw while loading, or a package it depends on is missing — is rethrown
 * as it arrived. A missing peer is never turned into `null` or `false`: the feature
 * was asked for, and it cannot run.
 *
 * Pass the same literal the import uses. For a synchronous `require()`, call the
 * handler from a `catch` block: `catch (e) { return optionalPeer("x", hint)(e); }`.
 *
 * @example
 * ```ts
 * import { optionalPeer } from "@zerotal/core/runtime";
 *
 * interface SdkModule {
 *   default: new (options: { apiKey: string }) => { messages: unknown };
 * }
 *
 * const sdk: SdkModule = await import("@anthropic-ai/sdk" as string).catch(
 *   optionalPeer("@anthropic-ai/sdk", { feature: 'AI driver "anthropic"' }),
 * );
 * ```
 *
 * @param spec - The import specifier, exactly as written in the `import()`.
 * @param hint - What needs the package, and what to do about it.
 * @returns A handler that always throws.
 */
export function optionalPeer(spec: string, hint: OptionalPeerHint): (error: unknown) => never {
  return (error: unknown): never => {
    if (!isMissing(error, spec)) throw error;
    const name = packageName(spec);
    throw new OptionalPeerMissingError(
      {
        peer: name,
        feature: hint.feature,
        install: hint.install ?? `bun add ${name}`,
        alternative: hint.alternative,
      },
      error,
    );
  };
}
