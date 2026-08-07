/**
 * `@zerotal/core/contracts` — the framework's interface layer.
 *
 * Every type here is **pure surface**: zero runtime code, and this subtree
 * imports nothing from the rest of core. Its job is to break the duck-typing at
 * the seams between the kernel and its satellite packages. Core consumes a
 * contract; a package (or a third-party alternative) implements it; neither
 * needs to import the other.
 *
 * | Contract | Kernel use | Implemented by |
 * | --- | --- | --- |
 * | {@link SessionContract} | `ctx.session`, `ctx.flash()` / `flashed()` | `@zerotal/session` |
 * | {@link TransactionContext} | `ctx._transaction`, `RequestContext.transaction()` | `@zerotal/orm` |
 * | {@link AuthenticatableUser} | the current-user identity | the app's User model |
 *
 * A package wires in by implementing the contract and merging into a registry —
 * never by reaching into an untyped side channel on `HttpContext`.
 *
 * @packageDocumentation
 */
export type { SessionContract } from "./session.ts";
export type { TransactionContext } from "./transaction.ts";
export type { AuthenticatableUser } from "./auth.ts";
