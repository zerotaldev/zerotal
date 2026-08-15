/**
 * Deploy targets — the environments this app is released to, and the pipeline each
 * one runs.
 *
 * Every target gets its own command: declare `production` and `staging` and you get
 * `bun zt deploy:production` and `bun zt deploy:staging`. The name is the whole
 * point of the split — it is checked against the deployment this process was
 * actually started as, so running the production pipeline against a staging box
 * stops on the first line rather than migrating the wrong database.
 *
 * The file is optional. Without it, `production` and `staging` exist with the
 * default pipeline, which is what most apps want.
 *
 * @example
 * ```ts
 * // config/deploy.ts
 * import { DeployConfig } from "zerotal/config";
 *
 * export default DeployConfig({
 *   targets: {
 *     production: { url: "https://example.com" },
 *     staging: { url: "https://staging.example.com" },
 *   },
 * });
 * ```
 */

/**
 * The release steps, in order. Each names a `zt` command; one that is not
 * registered is skipped, so an app without Inertia simply has no `inertia:build`.
 *
 * Ordered so that everything able to refuse runs before anything that mutates:
 * the build cannot corrupt a database and the migration cannot half-apply if the
 * preflight has already stopped the deploy.
 */
export const DEFAULT_DEPLOY_STEPS: readonly string[] = ["assets:build", "inertia:build", "migrate"];

/** One environment this app is released to. */
export interface DeployTarget {
  /**
   * The app's public URL in this environment. Used by `--probe` to run a real
   * WebSocket handshake against the deployed site, the way a browser would.
   */
  url?: string;
  /**
   * Override the release steps for this target. Defaults to
   * {@link DEFAULT_DEPLOY_STEPS}. Names a `zt` command per entry.
   */
  steps?: readonly string[];
}

/** The `deploy` config namespace. */
export interface DeployConfigShape {
  targets: Record<string, DeployTarget>;
}

/** The targets assumed when an app ships no `config/deploy.ts`. */
export const DEFAULT_DEPLOY_TARGETS: Record<string, DeployTarget> = {
  production: {},
  staging: {},
};

/**
 * Build the `deploy` config block, filling in defaults.
 *
 * @param options - The targets this app releases to.
 */
export function DeployConfig(options: Partial<DeployConfigShape> = {}): DeployConfigShape {
  const targets = options.targets ?? DEFAULT_DEPLOY_TARGETS;
  return { targets };
}
