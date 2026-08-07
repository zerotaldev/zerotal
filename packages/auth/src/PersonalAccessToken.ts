/**
 * Personal access tokens — long-lived API bearer credentials for a user
 * ("tokenable").
 *
 * @remarks
 * The plaintext token is generated and returned by {@link createToken} exactly
 * **once**; only its SHA-256 hex hash is ever persisted (`token` column). At
 * request time {@link BearerTokenMiddleware} hashes the presented bearer value
 * and looks the row up by hash, so a leaked database row cannot be replayed as a
 * credential. Each token carries an optional list of abilities (scopes): an empty
 * list — or the wildcard `['*']` — grants full access, otherwise access is limited
 * to the named abilities (see {@link tokenCan}). Tokens may also carry an
 * `expires_at`; the middleware treats an elapsed token as invalid.
 *
 * Create the backing table with:
 *
 * ```ts
 * await Schema.create('personal_access_tokens', (table) => {
 *   table.id();
 *   table.integer('tokenable_id');
 *   table.string('tokenable_type').default('user');
 *   table.string('name');
 *   table.string('token', 64).unique();   // SHA-256 hex of the plaintext token
 *   table.text('abilities').nullable();   // JSON array e.g. ["read","write"]
 *   table.timestamp('last_used_at').nullable();
 *   table.timestamp('expires_at').nullable();
 *   table.timestamps();
 * });
 * ```
 *
 * @packageDocumentation
 */

import { FrameworkEvents, sha256Hex } from "@zerotal/core";
import { TokenIssued } from "./events.ts";

/** A persisted personal-access-token row. The `token` field holds the SHA-256 hash, never the plaintext. */
export interface TokenRow {
  id: number;
  tokenable_id: number;
  tokenable_type: string;
  name: string;
  token: string; // SHA-256 hex hash
  abilities: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** The result of {@link createToken}: the one-time plaintext plus the row to persist. */
export interface NewToken {
  /** The plain-text token — show this to the user once and never store it. */
  plaintext: string;
  /** The row stored in the database (its `token` field is the SHA-256 hash of {@link plaintext}). */
  row: Omit<TokenRow, "id" | "created_at" | "updated_at">;
}

/**
 * Hash a plain-text token using SHA-256 (shared `sha256Hex` helper) — the same
 * transform applied at issue time and at verification time, so a presented bearer
 * value can be matched against the stored hash.
 *
 * @remarks Stays async for backward compatibility with existing callers, though
 * the underlying `sha256Hex` is synchronous.
 * @param plaintext - The raw token as presented by (or returned to) the client.
 * @returns The SHA-256 hex digest stored in the `token` column.
 * @category Verifying
 */
export async function hashToken(plaintext: string): Promise<string> {
  return sha256Hex(plaintext);
}

/**
 * Generate a new personal access token for a user.
 *
 * @remarks
 * Returns the plaintext **once** — it is never persisted. Only its SHA-256 hash
 * goes into `row.token`. Persist `row` yourself and hand `plaintext` back to the
 * client to use as an `Authorization: Bearer <plaintext>` credential. A
 * {@link TokenIssued} framework event is emitted (keyed by the token hash, since
 * no numeric DB id exists until the row is inserted). Omitting `abilities`
 * records `null` on the row, which {@link tokenCan} treats as full access.
 *
 * @param options.tokenableId - Primary key of the owning subject (e.g. `user.id`).
 * @param options.tokenableType - Polymorphic subject type; defaults to `"user"`.
 * @param options.name - Human label for the token (shown in a token-management UI).
 * @param options.abilities - Scopes granted; omit or use `['*']` for full access.
 * @param options.expiresAt - Optional absolute expiry; omit for a non-expiring token.
 * @returns A {@link NewToken} — the one-time `plaintext` and the `row` to insert.
 * @category Creating
 * @example
 * ```ts
 * const { plaintext, row } = await createToken({
 *   tokenableId: user.id,
 *   name:        'mobile-app',
 *   abilities:   ['read', 'write'],
 * });
 * // Persist the row, then return `plaintext` to the client once — it is never stored.
 * await PersonalAccessToken.query().insert(row);
 *
 * // The client then authenticates with it:
 * //   fetch('/api/posts', { headers: { Authorization: `Bearer ${plaintext}` } });
 * ```
 */
export async function createToken(options: {
  tokenableId: number;
  tokenableType?: string;
  name: string;
  abilities?: string[];
  expiresAt?: Date;
}): Promise<NewToken> {
  const plaintext = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const hash = await hashToken(plaintext);

  const row: NewToken["row"] = {
    tokenable_id: options.tokenableId,
    tokenable_type: options.tokenableType ?? "user",
    name: options.name,
    token: hash,
    abilities: options.abilities ? JSON.stringify(options.abilities) : null,
    last_used_at: null,
    expires_at: options.expiresAt ? options.expiresAt.toISOString() : null,
  };

  const abilities = options.abilities ?? ["*"];
  // No numeric DB id exists until the row is inserted; the token hash is the
  // stable unique identifier available at issue time.
  FrameworkEvents.emit(new TokenIssued(hash, abilities, options.tokenableId));

  return { plaintext, row };
}

/**
 * Check whether a token grants a specific ability (scope).
 *
 * @remarks
 * A `null` abilities column or the wildcard `['*']` is treated as full access.
 * If the stored `abilities` JSON fails to parse, this fails **closed** (returns
 * `false`) rather than granting access.
 *
 * @param row - The stored token row (as loaded by {@link BearerTokenMiddleware}).
 * @param ability - The ability name to check for, e.g. `"write"`.
 * @returns `true` when the token may perform `ability`.
 * @category Verifying
 */
export function tokenCan(row: TokenRow, ability: string): boolean {
  if (!row.abilities) return true;
  let abilities: string[];
  try {
    abilities = JSON.parse(row.abilities) as string[];
  } catch {
    return false;
  }
  return abilities.includes("*") || abilities.includes(ability);
}
