/**
 * The boot-time doctor — one verification pass, after providers have booted,
 * that turns latent wiring mistakes into loud, named startup failures instead of
 * mid-request surprises.
 *
 * Its first (and cheapest) job is the provider `provides` contract: every token
 * a provider names in `static provides` must actually be wired, and — in real
 * runtimes — resolvable. Eager-resolving those singletons at boot also closes
 * the facade temporal-coupling trap: a facade's synchronous `makeSync` needs its
 * singleton pre-resolved, and resolving them centrally here means an individual
 * provider does not need its own `onBooted` pre-resolve step.
 */
import type { Container } from "../container/Container.ts";
import type { ContainerBindings } from "../container/types.ts";
import type { ServiceProvider } from "../provider/ServiceProvider.ts";
import { ZerotalError } from "../errors/ZerotalError.ts";

/** A single wiring problem found by {@link runBootDoctor}. */
export interface BootCheckFailure {
  /** The container token that failed its check. */
  token: string;
  /** The provider class that declared the token in `static provides`. */
  provider: string;
  /** Why it failed — either "not bound", or the construction error message. */
  reason: string;
}

/**
 * Thrown when the boot-time doctor finds one or more wiring problems. Lists every
 * culprit by token and declaring provider, so a startup failure names exactly
 * what to fix.
 *
 * @category Errors
 */
export class BootCheckError extends ZerotalError {
  constructor(public readonly failures: BootCheckFailure[]) {
    super(BootCheckError._format(failures), "E_BOOT_CHECK_FAILED", 500, { failures });
  }

  private static _format(failures: BootCheckFailure[]): string {
    const lines = failures.map((f) => `  • "${f.token}" (declared by ${f.provider}): ${f.reason}`);
    const plural = failures.length === 1 ? "" : "s";
    return `[Zerotal] Boot-time doctor found ${failures.length} wiring problem${plural}:\n${lines.join("\n")}`;
  }
}

/** The static shape the doctor reads off a provider class. */
type ProviderStatics = { provides?: readonly (keyof ContainerBindings)[]; name: string };

/**
 * Verify the application's wiring before it starts serving.
 *
 * For every token a provider declares in `static provides`:
 * - **always** verify the token is bound in the container — a token declared but
 *   never registered is a wiring mistake, and this check constructs nothing, so
 *   it is safe to run in every environment (including tests);
 * - when `eagerResolve` is set, additionally resolve each **non-deferred**
 *   singleton now, so a construction error surfaces here as a named boot failure
 *   rather than on the first request that touches its facade.
 *
 * Deferred bindings are verified as bound but never eager-resolved — resolving
 * one would boot its provider and defeat the deferral.
 *
 * @param providers - The application's active provider instances.
 * @param container - The application container the providers registered into.
 * @param options - `eagerResolve` turns on construction of non-deferred
 *   singletons (real runtimes); leave it off in tests/REPL to avoid side effects.
 * @throws {BootCheckError} listing every culprit when one or more checks fail.
 */
export async function runBootDoctor(
  providers: readonly ServiceProvider[],
  container: Container,
  options: { eagerResolve: boolean },
): Promise<void> {
  const failures: BootCheckFailure[] = [];

  for (const provider of providers) {
    const ctor = provider.constructor as unknown as ProviderStatics;
    const provides = ctor.provides;
    if (!provides || provides.length === 0) continue;

    for (const token of provides) {
      if (!container.bound(token)) {
        failures.push({
          token: String(token),
          provider: ctor.name,
          reason:
            "declared in `static provides` but no binding was registered (bind it in onRegister)",
        });
        continue;
      }

      if (options.eagerResolve && !container.isDeferred(token)) {
        try {
          await container.make(token);
        } catch (error) {
          failures.push({
            token: String(token),
            provider: ctor.name,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  if (failures.length > 0) throw new BootCheckError(failures);
}
