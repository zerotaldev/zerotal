/**
 * `make:policy` — scaffolds an authorization policy class into `app/policies/`.
 *
 * One implementation, in `@zerotal/core/commands`: the CLI registers it before any provider
 * boots, so a second copy here was the one that never ran — and the two had drifted apart.
 *
 * @example
 * ```ts
 * // bun zt make:policy PostPolicy
 * // bun zt make:policy CommentAccess --model Comment
 * ```
 */
export { MakePolicyCommand } from "@zerotal/core/commands";
