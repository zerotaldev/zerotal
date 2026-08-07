import { createFacade } from "@zerotal/core";

/**
 * The `Hash` facade — password hashing, backed by {@link HashService} (native
 * `Bun.password`).
 *
 * @remarks
 * Resolves the `hash` binding from the container, so it is usable only after
 * `app.boot()`. The service uses **argon2id** by default (stronger than bcrypt
 * for new projects); the algorithm marker is embedded in the returned hash, so
 * {@link HashService.check | check} and {@link HashService.needsRehash | needsRehash}
 * need no configuration to verify existing hashes. {@link Auth.attempt} calls
 * `needsRehash` and transparently upgrades stored hashes on login.
 *
 * Available methods: `make(password)`, `check(password, hash)`,
 * `needsRehash(hash)`, `selfTest()` — see {@link HashService}.
 *
 * @example
 * ```ts
 * import { Hash } from '@zerotal/auth';
 *
 * const hash  = await Hash.make('secret123');   // argon2id hash to persist
 * const valid = await Hash.check('secret123', hash); // true
 * ```
 */
export const Hash = createFacade("hash");
