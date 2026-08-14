/**
 * The dev-process registry: what `bun zt dev` runs alongside the server.
 *
 * An app with a queue needs a worker running next to its server, and today that
 * is a second terminal the developer has to remember to restart by hand. Every
 * package with a companion process has the same gap — a type-checker, a Stripe
 * listener, a Tailwind watcher — and until now there was no way for a package to
 * close it, because the dev runner only knew about the server.
 *
 * A provider contributes one by overriding `devProcesses()`, the same shape as
 * `replContext()`: the package declares what it needs, the tooling decides what
 * to do with it.
 *
 * ## Why this is not the build hook
 *
 * `registerDevBuildHook` exists for *builds*, and a build is a step that has to
 * finish before the server restarts — a failure there aborts the reload, which is
 * correct, because serving a page against a half-built bundle is worse than not
 * reloading. A process is the opposite: it runs for as long as dev mode does, and
 * its death must never take the server with it. Two different lifetimes, two
 * different failure rules, two different mechanisms.
 */
import type { ServiceProvider } from "../provider/ServiceProvider.ts";

/** What a provider or an app declares when it contributes a dev process. */
export interface DevProcessDefinition {
  /**
   * Stable identity, and what the user types in `--only` / `--without`.
   *
   * Registering a name twice replaces the earlier definition rather than adding
   * a second entry, so an app can swap out a provider's worker for its own.
   */
  name: string;
  /**
   * What to run, in one of three forms:
   *
   * - `"queue:work"` — a bare string is a `zt` command, resolved against the
   *   app's own entrypoint, so it picks up the same bootstrap the CLI does.
   * - `["stripe", "listen"]` — raw argv, for a tool that is not a zt command.
   * - `() => [...]` — the same, computed at startup when the argv depends on
   *   config the provider can only read once the app has booted.
   *
   * Mutually exclusive with {@link run}.
   */
  command?: string | string[] | (() => string[]);
  /**
   * Run in-process instead of spawning, for work that has no separate binary.
   * The signal aborts on shutdown and on a restart.
   *
   * Mutually exclusive with {@link command}.
   */
  run?: (signal: AbortSignal) => Promise<void>;
  /**
   * Whether to run at all. A function is resolved **once**, at startup, so a
   * provider can consult its own config — and so a process cannot flicker in
   * and out of the deck while dev mode is running.
   */
  enabled?: boolean | (() => boolean | Promise<boolean>);
  /** Restart policy. Defaults to `"on-failure"`. */
  restart?: "always" | "on-failure" | "never";
  /**
   * `"server"` waits for the server to be up before starting — for a process
   * that talks to it. Defaults to `"none"`, which starts immediately.
   */
  after?: "server" | "none";
  /** Display name for the tab. Defaults to {@link name}. */
  label?: string;
  /** Tab colour. Auto-assigned from the palette when omitted. */
  color?: DevProcessColor;
}

/** The colours a deck tab can take. Named, not ANSI codes, so the deck owns the rendering. */
export type DevProcessColor = "cyan" | "magenta" | "yellow" | "green" | "blue" | "red";

/** Assigned in order to processes that did not pick a colour. */
const _PALETTE: DevProcessColor[] = ["cyan", "magenta", "yellow", "green", "blue", "red"];

/** A definition with every default filled in and its argv settled. */
export interface ResolvedDevProcess {
  name: string;
  label: string;
  color: DevProcessColor;
  /** Settled argv, when this is a spawned process. */
  argv?: string[];
  /** The in-process body, when this is a `run` process. */
  run?: (signal: AbortSignal) => Promise<void>;
  restart: "always" | "on-failure" | "never";
  after: "server" | "none";
  /**
   * Who registered it — a provider class name, or `"app.dev.processes"`.
   *
   * Kept so `zt dev --list` can answer "why is this running?", which is the
   * question a developer actually has when an unfamiliar tab appears.
   */
  registrant: string;
}

/** The `app.dev` config block. */
export interface DevConfigShape {
  /** App-level processes, registered after every provider's. */
  processes?: DevProcessDefinition[];
  /** Names to drop, whoever registered them. */
  disable?: string[];
}

/** The bits of `Application` this module needs — kept structural to avoid a cycle. */
interface ProviderHost {
  _activeProviders: ServiceProvider[];
}

/** The bits of `ConfigManager` this module needs. */
interface ConfigReader {
  get<T>(key: string, fallback?: T): T | undefined;
}

/**
 * Gather every dev process the booted app has to offer.
 *
 * Collection order is providers in boot order, then `app.dev.processes`, so an
 * app always gets the last word. Name collisions replace in place rather than
 * appending, which keeps the deck's tab order stable when an app overrides one.
 *
 * @param app     A booted application — providers must have run, since `enabled`
 *                and a `command` thunk are allowed to read config.
 * @param config  The config manager, read for `app.dev`.
 */
export async function collectDevProcesses(
  app: ProviderHost,
  config?: ConfigReader,
): Promise<ResolvedDevProcess[]> {
  const devConfig = config?.get<DevConfigShape>("app.dev") ?? {};
  const declared = new Map<string, { definition: DevProcessDefinition; registrant: string }>();

  for (const provider of app._activeProviders) {
    const contributed = provider.devProcesses?.() ?? [];
    const registrant = provider.constructor.name;
    for (const definition of contributed) {
      _assertShape(definition, registrant);
      declared.set(definition.name, { definition, registrant });
    }
  }

  for (const definition of devConfig.processes ?? []) {
    _assertShape(definition, "app.dev.processes");
    declared.set(definition.name, { definition, registrant: "app.dev.processes" });
  }

  const disabled = new Set(devConfig.disable ?? []);
  const resolved: ResolvedDevProcess[] = [];
  let paletteIndex = 0;

  for (const { definition, registrant } of declared.values()) {
    if (disabled.has(definition.name)) continue;
    if (!(await _isEnabled(definition))) continue;

    // Consumed only by processes that survived the filters, so removing one
    // does not re-colour the others.
    const color = definition.color ?? _PALETTE[paletteIndex++ % _PALETTE.length]!;

    resolved.push({
      name: definition.name,
      label: definition.label ?? definition.name,
      color,
      ...(definition.command !== undefined ? { argv: _toArgv(definition.command) } : {}),
      ...(definition.run !== undefined ? { run: definition.run } : {}),
      restart: definition.restart ?? "on-failure",
      after: definition.after ?? "none",
      registrant,
    });
  }

  return resolved;
}

/**
 * Reject a definition that cannot be run, naming who registered it.
 *
 * Both errors are authoring mistakes in a provider the developer may not own, so
 * the message has to say which package to go and look at.
 */
function _assertShape(definition: DevProcessDefinition, registrant: string): void {
  if (!definition.name) {
    throw new Error(`[Zerotal] ${registrant} registered a dev process with no name.`);
  }
  const hasCommand = definition.command !== undefined;
  const hasRun = definition.run !== undefined;
  if (hasCommand === hasRun) {
    throw new Error(
      `[Zerotal] Dev process "${definition.name}" (from ${registrant}) must set exactly one of ` +
        `\`command\` or \`run\`, not ${hasCommand ? "both" : "neither"}.`,
    );
  }
}

/** Resolve `enabled` once. Anything that throws is treated as "not enabled". */
async function _isEnabled(definition: DevProcessDefinition): Promise<boolean> {
  const enabled = definition.enabled;
  if (enabled === undefined) return true;
  if (typeof enabled !== "function") return enabled;
  try {
    return await enabled();
  } catch {
    // A provider probing config that is absent should leave its process out,
    // not fail dev mode for every other process in the deck.
    return false;
  }
}

/**
 * Settle a `command` into argv.
 *
 * A bare string is a zt command and runs through `Bun.main` — the app's own
 * entrypoint — so it boots the same providers and reads the same config the
 * developer's `bun zt queue:work` would. Splitting on whitespace is deliberate
 * and shallow: anything needing quoting should use the array form.
 */
function _toArgv(command: string | string[] | (() => string[])): string[] {
  if (typeof command === "function") return command();
  if (Array.isArray(command)) return command;
  return ["bun", Bun.main, ...command.split(/\s+/).filter(Boolean)];
}
