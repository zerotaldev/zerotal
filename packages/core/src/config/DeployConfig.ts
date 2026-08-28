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

/**
 * The command a deploy runs before anything else, when the app defines one.
 *
 * A convention rather than a required declaration, because the alternative is the
 * failure this exists to prevent: an app writes a preflight command, forgets to
 * wire it into the pipeline, and every refusal that command knows how to make sits
 * behind something nobody is obliged to run. **A gate nothing calls is a comment.**
 *
 * Register a command by this name and the pipeline finds it. Declare `preflight`
 * on a target to run something else, or to run more than one.
 */
export const CONVENTIONAL_PREFLIGHT_COMMAND = "release:check";

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
  /**
   * App-owned commands that run in the preflight phase — after the framework's
   * own config validators and `doctor`, and before any step that mutates
   * anything. A non-zero exit refuses the release.
   *
   * This is the slot for the checks only the app can make. The framework can tell
   * you the `APP_KEY` is the one from `.env.example`; it cannot tell you this
   * workspace has no cancellation policy, or that the owner account is still on
   * the password the installer issued it. Those refusals are yours, and until
   * there was somewhere to put them they lived in a command nobody ran.
   *
   * Defaults to {@link CONVENTIONAL_PREFLIGHT_COMMAND} when that command is
   * registered, and to nothing when it is not.
   *
   * @example
   * ```ts
   * production: { preflight: ["release:check", "assets:verify"] }
   * ```
   */
  preflight?: readonly string[];
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
