/**
 * Registers console commands, parses their arguments and flags from argv, and
 * dispatches execution — both for the CLI and for in-process calls from HTTP
 * handlers. Also turns closure-style command definitions into command classes.
 */
import { parseArgs } from "node:util";
import type { Application } from "../application/Application.ts";
import { Command } from "./Command.ts";
import type { ArgDef, FlagDef } from "./Command.ts";
import { BufferWriter } from "./OutputWriter.ts";
import { FrameworkEvents, CommandRan } from "../events/FrameworkEvents.ts";
import { makeDeployCommand } from "./builtin/DeployCommand.ts";
import { DEFAULT_DEPLOY_TARGETS } from "../config/DeployConfig.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CommandStatic {
  new (): Command;
  commandName: string;
  description?: string;
  needsApp?: boolean;
  args: ArgDef[];
  flags: FlagDef[];
}

type CommandClass = CommandStatic;
type CommandThunk = () => Promise<CommandClass>;

/** A closure-style command: a signature string plus a handler to run. */
export interface CommandDefinition {
  signature: string;
  description?: string;
  handle: (
    params: Record<string, string | boolean | number>,
    command: Command,
  ) => void | Promise<void>;
}

/**
 * Parse an Artisan-style signature string (e.g. `make:thing {name} {--force}`)
 * into the command name and its argument and flag definitions.
 *
 * @param signature - The signature: a command name followed by `{arg}`,
 *   `{arg?}`, `{arg=default}`, `{--flag}`, or `{--flag=default}` tokens.
 * @returns The parsed command `name` with its `args` and `flags`.
 * @internal
 */
export function parseSignature(signature: string): {
  name: string;
  args: ArgDef[];
  flags: FlagDef[];
} {
  const tokens = signature.trim().match(/\S+/g) ?? [];
  const name = tokens[0] ?? "";
  const args: ArgDef[] = [];
  const flags: FlagDef[] = [];

  for (const token of tokens.slice(1)) {
    const braceMatch = token.match(/^\{(.+)\}$/);
    if (!braceMatch) continue;
    const body = braceMatch[1]!;
    if (body.startsWith("--")) {
      const flagBody = body.slice(2);
      const equalsIndex = flagBody.indexOf("=");
      if (equalsIndex === -1) {
        flags.push({ name: flagBody, type: "boolean", default: false });
      } else {
        const flagName = flagBody.slice(0, equalsIndex);
        const defaultValue = flagBody.slice(equalsIndex + 1);
        flags.push({ name: flagName, type: "string", default: defaultValue || undefined });
      }
    } else {
      const equalsIndex = body.indexOf("=");
      if (equalsIndex !== -1) {
        args.push({
          name: body.slice(0, equalsIndex),
          required: false,
          default: body.slice(equalsIndex + 1),
        });
      } else if (body.endsWith("?")) {
        args.push({ name: body.slice(0, -1), required: false });
      } else {
        args.push({ name: body, required: true });
      }
    }
  }

  return { name, args, flags };
}

/**
 * Build an anonymous {@link Command} subclass from a closure-style definition.
 *
 * @param definition - The signature, optional description, and `handle` closure.
 * @returns A ready-to-register {@link Command} subclass whose `run()` invokes `handle`.
 * @internal
 */
export function commandFromDefinition(definition: CommandDefinition): CommandClass {
  const { name, args, flags } = parseSignature(definition.signature);
  const Synthetic = class extends Command {
    static commandName = name;
    static description = definition.description ?? "";
    static needsApp = false;
    static args = args;
    static flags = flags;
    async run(): Promise<void> {
      await definition.handle({ ...this.args, ...this.flags }, this);
    }
  };
  Object.defineProperty(Synthetic, "name", { value: `Closure<${name}>` });
  return Synthetic as unknown as CommandClass;
}

type ParseArgsOption = {
  type: "string" | "boolean";
  short?: string;
  default?: string | boolean;
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildParseOptions(flags: FlagDef[]): Record<string, ParseArgsOption> {
  const options: Record<string, ParseArgsOption> = {};
  for (const flag of flags) {
    const option: ParseArgsOption = {
      type: flag.type === "number" ? "string" : flag.type,
    };
    if (flag.short !== undefined) option.short = flag.short;
    if (flag.default !== undefined)
      option.default = flag.type === "boolean" ? (flag.default as boolean) : String(flag.default);
    options[flag.name] = option;
  }
  return options;
}

/** `<required>` / `[optional]` signature for a command's positional arguments. */
function argumentSignature(Cmd: CommandClass): string {
  return (Cmd.args ?? [])
    .map((argument) => (argument.required ? `<${argument.name}>` : `[${argument.name}]`))
    .join(" ");
}

function parseFlagsAndArgs(
  Cmd: CommandClass,
  rawArgv: string[],
): {
  parsedArgs: Record<string, string>;
  parsedFlags: Record<string, string | boolean | number>;
  /** Names of `required` arguments the caller omitted. */
  missingArgs: string[];
} {
  const { values: rawFlags, positionals } = parseArgs({
    args: rawArgv,
    options: buildParseOptions(Cmd.flags ?? []),
    strict: false,
    allowPositionals: true,
  });

  const parsedFlags: Record<string, string | boolean | number> = {};
  for (const flag of Cmd.flags ?? []) {
    const rawValue = rawFlags[flag.name];
    if (flag.type === "number" && typeof rawValue === "string") {
      parsedFlags[flag.name] = Number(rawValue);
    } else if (rawValue !== undefined) {
      parsedFlags[flag.name] = rawValue as string | boolean;
    } else if (flag.default !== undefined) {
      parsedFlags[flag.name] = flag.default as string | boolean | number;
    }
  }

  const parsedArgs: Record<string, string> = {};
  const missingArgs: string[] = [];
  for (let index = 0; index < (Cmd.args ?? []).length; index++) {
    const argument = Cmd.args[index]!;
    const value = positionals[index] ?? argument.default;
    // `required` used to be decorative — it shaped the help text and nothing
    // else, so an omitted argument arrived as "" and each command improvised.
    // `make:migration` with no name wrote `001_.ts` containing `class  {`.
    if (value === undefined && argument.required) missingArgs.push(argument.name);
    parsedArgs[argument.name] = value ?? "";
  }

  return { parsedArgs, parsedFlags, missingArgs };
}

// ── CommandRunner ─────────────────────────────────────────────────────────────

/**
 * Registry and dispatcher for console commands.
 *
 * Holds the map of command name (and aliases) to command class, parses argv into
 * the arguments and flags each command declares, and runs the matched command —
 * either as a CLI process via {@link CommandRunner.run} (which calls
 * `process.exit`) or in-process via {@link CommandRunner.callInProcess} (which
 * captures output and returns a status code). Commands can be registered as
 * classes ({@link CommandRunner.register}), from closure-style definitions
 * ({@link CommandRunner.command}), as lazy thunks ({@link CommandRunner.registerLazy}),
 * or discovered from a directory ({@link CommandRunner.discover}).
 *
 * @example
 * ```ts
 * const runner = new CommandRunner(app);
 *
 * // Register a command class…
 * runner.register(GreetCommand, ["hello"]);
 *
 * // …or define one inline with an Artisan-style signature.
 * runner.command({
 *   signature: "cache:clear {--tag=}",
 *   description: "Clear the application cache",
 *   handle: async (params, command) => {
 *     command.info(`Clearing ${params["tag"] ?? "all"} cache…`);
 *   },
 * });
 *
 * // Dispatch the argv the CLI entry point received.
 * await runner.run(process.argv.slice(2)); // e.g. `bun zt greet Ada`
 * ```
 */
export class CommandRunner {
  private _registry = new Map<string, CommandClass | CommandThunk>();

  constructor(private readonly _app: Application) {}

  // ── Registration ──────────────────────────────────────────────────────────

  /** Register a command class under its name and any aliases. */
  register(Cmd: CommandClass, aliases: string[] = []): void {
    this._registry.set(Cmd.commandName, Cmd);
    for (const alias of aliases) this._registry.set(alias, Cmd);
  }

  /** Register several command classes at once. */
  registerAll(commandClasses: CommandClass[]): void {
    for (const commandClass of commandClasses) this.register(commandClass);
  }

  /** Build and register a command from a closure-style definition. */
  command(definition: CommandDefinition, aliases: string[] = []): CommandClass {
    const Cmd = commandFromDefinition(definition);
    this.register(Cmd, aliases);
    return Cmd;
  }

  /** Alias for {@link CommandRunner.command}. */
  registerCommand(definition: CommandDefinition, aliases: string[] = []): CommandClass {
    return this.command(definition, aliases);
  }

  /**
   * Import every non-test module under a directory and register any exported
   * command classes it finds. Returns the names that were registered.
   */
  async discover(dir: string): Promise<string[]> {
    const registered: string[] = [];
    let glob: { scan(opts: { cwd: string; onlyFiles: boolean }): AsyncIterable<string> };
    try {
      glob = new Bun.Glob("**/*.{ts,js}");
    } catch {
      return registered;
    }
    try {
      for await (const file of glob.scan({ cwd: dir, onlyFiles: true })) {
        if (file.endsWith(".test.ts") || file.endsWith(".test.js")) continue;
        let module: Record<string, unknown>;
        try {
          module = (await import(`${dir}/${file}`)) as Record<string, unknown>;
        } catch {
          continue;
        }
        for (const exported of Object.values(module)) {
          if (CommandRunner._isCommandClass(exported)) {
            this.register(exported);
            registered.push(exported.commandName);
          }
        }
      }
    } catch {
      /* discovery is best-effort — ignore load failures */
    }
    return registered;
  }

  private static _isCommandClass(value: unknown): value is CommandClass {
    return (
      typeof value === "function" &&
      value !== Command &&
      value.prototype instanceof Command &&
      typeof (value as { commandName?: unknown }).commandName === "string" &&
      (value as unknown as { commandName: string }).commandName.length > 0
    );
  }

  /**
   * Register a command as a lazy thunk.
   * The module is only imported if/when the command is called.
   * Use this in web mode to avoid parsing CLI files during HTTP boot.
   *
   * @example
   * runner.registerLazy('cache:clear',
   *   () => import('@zerotal/cache/commands').then(m => m.CacheClearCommand)
   * );
   */
  registerLazy(name: string, thunk: CommandThunk, aliases: string[] = []): void {
    this._registry.set(name, thunk);
    for (const alias of aliases) this._registry.set(alias, thunk);
  }

  /**
   * Whether a command is registered, without resolving it.
   *
   * Lets a caller compose a pipeline out of whatever this app actually has —
   * `zt deploy:<env>` skips `inertia:build` in an app with no Inertia rather than
   * failing on it. Deliberately does not resolve the lazy thunk: asking whether a
   * step exists should not import the package that provides it.
   */
  has(name: string): boolean {
    return this._registry.has(name);
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  /**
   * Register self in the container, boot the application, and register the
   * built-in commands appropriate to the current environment.
   *
   * Called by the CLI entry point (`zt.ts`) before {@link CommandRunner.run}.
   *
   * Environment is set by `zt.ts` via Bun.env['APP_ENV'] BEFORE bootstrap/app.ts
   * is dynamically imported. Application.create() reads it, so _env is already
   * correct by the time boot() runs — no argv inspection needed here.
   */
  async boot(): Promise<void> {
    this._app.container.value("commands", this);
    await this._app.boot();

    const {
      ServeCommand,
      DevCommand,
      ReplCommand,
      WorkerCommand,
      CompileCommand,
      KeyGenerateCommand,
      ReloadCommand,
      StatusCommand,
      MakeControllerCommand,
      MakeMiddlewareCommand,
      MakeCommandCommand,
      MakeRequestCommand,
      MakeEventCommand,
      MakeListenerCommand,
      MakeJobCommand,
      MakePolicyCommand,
      MakeNotificationCommand,
      MakeObserverCommand,
      MakeResourceCommand,
      MakeTestCommand,
      TestCommand,
      RouteListCommand,
      RouteTypesCommand,
      DoctorCommand,
      MakeProviderCommand,
      CssBuildCommand,
      AssetsBuildCommand,
      LintPackagesCommand,
      MakePackageCommand,
    } = await import("./builtin/index.ts");

    // ServeCommand is always registered — usable from any environment.
    this.register(ServeCommand);

    // So is `dev`, and it has to be: `setAppEnv("dev")` boots process 1 as `web`
    // so that web-only providers are asked for their dev processes, which puts
    // the command itself on the wrong side of the `!== "web"` gate below.
    this.register(DevCommand);

    // reload + status are always available — they talk to the running server,
    // not the app itself, so they don't need an application instance.
    this.register(ReloadCommand);
    this.register(StatusCommand);

    // route:list and doctor are inspection commands — always available regardless of mode.
    this.register(RouteListCommand);
    this.register(DoctorCommand);

    // route:types reads the same booted router, so it is available wherever
    // route:list is — including in CI containers that only ever run `--check`.
    this.register(RouteTypesCommand, ["routes:types"]);

    // Non-web commands (console, worker, test).
    if (this._app._env !== "web") {
      this.register(ReplCommand);
      this.register(CompileCommand, ["build"]);
      this.registerAll([
        WorkerCommand,
        KeyGenerateCommand,
        MakeProviderCommand,
        MakeControllerCommand,
        MakeMiddlewareCommand,
        MakeCommandCommand,
        MakeRequestCommand,
        MakeEventCommand,
        MakeListenerCommand,
        MakeJobCommand,
        MakePolicyCommand,
        MakeNotificationCommand,
        MakeObserverCommand,
        MakeResourceCommand,
        MakeTestCommand,
        TestCommand,
        CssBuildCommand,
        AssetsBuildCommand,
        LintPackagesCommand,
        MakePackageCommand,
      ]);

      // One `deploy:<target>` per environment this app releases to. Console-only,
      // like the other release commands — a running web server has no business
      // migrating a database.
      this._registerDeployTargets();

      // `make:command` generates into `app/commands/`; the runner reads the same
      // directory, so a generated command is runnable without registering a provider.
      // App commands land last, after the built-ins, so a name collision resolves in
      // the app's favour.
      await this._discoverAppCommands();
    }
  }

  /**
   * Register `deploy:<target>` for each target in `config/deploy.ts`, or for
   * `production` and `staging` when the app declares none.
   *
   * Runs after `boot()` has loaded config, so the targets are readable here for the
   * same reason `_discoverAppCommands` can read the conventions block.
   */
  private _registerDeployTargets(): void {
    let targets = DEFAULT_DEPLOY_TARGETS;
    try {
      const config = this._app.container.makeSync("config") as {
        get(key: string, fallback?: unknown): unknown;
      };
      const declared = config.get("deploy.targets", undefined) as
        Record<string, unknown> | undefined;
      if (declared && Object.keys(declared).length > 0) targets = declared as typeof targets;
    } catch {
      /* no config store — the defaults are the answer */
    }
    for (const target of Object.keys(targets)) this.register(makeDeployCommand(target));
  }

  /**
   * Auto-discover commands from the conventional directory (`app/commands/`, overridable
   * via `app.conventions.paths.commands`). Gated by `app.conventions.enabled`, like every
   * other convention. Best-effort: a missing directory registers nothing.
   */
  private async _discoverAppCommands(root: string = process.cwd()): Promise<string[]> {
    let raw: { enabled?: boolean; paths?: Record<string, string> } = {};
    try {
      const config = this._app.container.makeSync("config") as {
        get(key: string): unknown;
      };
      raw = (config.get("app.conventions") ?? {}) as typeof raw;
    } catch {
      /* config not resolvable — use the defaults */
    }
    if (raw.enabled === false) return [];
    return this.discover(`${root}/${raw.paths?.["commands"] ?? "app/commands"}`);
  }

  // ── Private resolution ────────────────────────────────────────────────────

  /** Resolve a command name to its class — handles both eager and lazy entries. */
  private async _resolve(name: string): Promise<CommandClass | undefined> {
    const entry = this._registry.get(name);
    if (!entry) return undefined;

    // A CommandClass has a 'commandName' static property; a thunk does not.
    if (typeof entry === "function" && !("commandName" in entry)) {
      const Cmd = await (entry as CommandThunk)();
      // Cache the resolved class — subsequent calls are instant
      this._registry.set(name, Cmd);
      return Cmd;
    }
    return entry as CommandClass;
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  /**
   * Parse argv, run the matched command, and exit the process with its status.
   * Handles the built-in `list` and `help` commands. Intended for CLI use.
   */
  async run(argv: string[]): Promise<void> {
    const commandName = argv[0] ?? "";
    if (commandName === "list" || commandName === "") {
      this._printList();
      return;
    }
    if (commandName === "help") {
      await this._printHelp(argv[1] ?? "");
      return;
    }
    const Cmd = await this._resolve(commandName);

    if (!Cmd) {
      console.error(`\x1b[31mUnknown command: "${commandName}"\x1b[0m`);
      process.exit(1);
    }

    const { parsedArgs, parsedFlags, missingArgs } = parseFlagsAndArgs(Cmd, argv.slice(1));

    if (missingArgs.length > 0) {
      console.error(
        `\x1b[31mMissing required argument${missingArgs.length > 1 ? "s" : ""}: ${missingArgs.join(", ")}\x1b[0m`,
      );
      console.error(`\x1b[1mUsage:\x1b[0m ${commandName} ${argumentSignature(Cmd)}`);
      process.exit(1);
    }

    const instance = new Cmd();
    (instance as unknown as Record<string, unknown>).args = parsedArgs;
    (instance as unknown as Record<string, unknown>).flags = parsedFlags;
    (instance as unknown as Record<string, unknown>).app = this._app;

    const name = (Cmd as { commandName?: string }).commandName ?? commandName;
    const startedAt = performance.now();
    try {
      await instance.run();
      FrameworkEvents.emit(new CommandRan(name, performance.now() - startedAt, 0, true));
      process.exit(0);
    } catch (error) {
      FrameworkEvents.emit(
        new CommandRan(name, performance.now() - startedAt, 1, false, (error as Error).message),
      );
      console.error(`\x1b[31m✖ ${(error as Error).message}\x1b[0m`);
      process.exit(1);
    }
  }

  /**
   * Run a command in-process and return { code, output }.
   * Does NOT call process.exit(). Safe to call from HTTP handlers.
   * Output is captured via BufferWriter — nothing is written to stdout.
   *
   * See: plans/boot-modes.md §6
   */
  async callInProcess(
    argv: string[],
    parameters: Record<string, string | boolean | number> = {},
  ): Promise<{ code: number; output: string }> {
    const commandName = argv[0] ?? "";
    const Cmd = await this._resolve(commandName);

    if (!Cmd) {
      return { code: 1, output: `Unknown command: "${commandName}"\n` };
    }

    // Build argv array from parameters object if provided separately
    const fullArgv = argv.length > 1 ? [...argv] : [commandName];
    for (const [key, value] of Object.entries(parameters)) {
      if (typeof value === "boolean") {
        if (value) fullArgv.push(key);
      } else {
        fullArgv.push(`${key}=${String(value)}`);
      }
    }

    const { parsedArgs, parsedFlags, missingArgs } = parseFlagsAndArgs(Cmd, fullArgv.slice(1));

    if (missingArgs.length > 0) {
      const plural = missingArgs.length > 1 ? "s" : "";
      return {
        code: 1,
        output:
          `\x1b[31m✖ Missing required argument${plural}: ${missingArgs.join(", ")}\x1b[0m\n` +
          `Usage: ${commandName} ${argumentSignature(Cmd)}\n`,
      };
    }

    // Instantiate with BufferWriter — output is captured, not printed
    const instance = new Cmd();
    const writer = new BufferWriter();
    (instance as any)._writer = writer;
    (instance as any).args = parsedArgs;
    (instance as any).flags = parsedFlags;
    (instance as any).app = this._app;

    const name = (Cmd as { commandName?: string }).commandName ?? commandName;
    const startedAt = performance.now();
    try {
      await instance.run();
      FrameworkEvents.emit(new CommandRan(name, performance.now() - startedAt, 0, true));
      return { code: 0, output: writer.flush() };
    } catch (error) {
      FrameworkEvents.emit(
        new CommandRan(name, performance.now() - startedAt, 1, false, (error as Error).message),
      );
      const errorLine = `\x1b[31m✖ ${(error as Error).message}\x1b[0m\n`;
      return { code: 1, output: writer.flush() + errorLine };
    }
  }

  private _printList(): void {
    const groups = new Map<CommandClass | CommandThunk, string[]>();
    for (const [name, entry] of this._registry) {
      const list = groups.get(entry) ?? [];
      list.push(name);
      groups.set(entry, list);
    }

    type Row = { name: string; description: string; aliases: string[] };
    const rows: Row[] = [];
    for (const [entry, names] of groups) {
      const isClass = typeof entry === "function" && "commandName" in entry;
      const primary = isClass ? (entry as CommandClass).commandName : names[0]!;
      const description = isClass
        ? ((entry as CommandClass).description ?? "")
        : "(lazy — run to load)";
      const aliases = names.filter((registeredName) => registeredName !== primary);
      rows.push({ name: primary, description, aliases });
    }

    rows.sort((first, second) => first.name.localeCompare(second.name));
    const columnWidth = Math.max(0, ...rows.map((row) => row.name.length)) + 4;

    console.log("\x1b[1mAvailable commands:\x1b[0m");
    for (const row of rows) {
      const alias = row.aliases.length ? ` \x1b[2m(alias: ${row.aliases.join(", ")})\x1b[0m` : "";
      console.log(`  ${row.name.padEnd(columnWidth)}\x1b[2m${row.description}\x1b[0m${alias}`);
    }
  }

  private async _printHelp(name: string): Promise<void> {
    if (!name) {
      this._printList();
      return;
    }
    const Cmd = await this._resolve(name);
    if (!Cmd) {
      console.error(`\x1b[31mUnknown command: "${name}"\x1b[0m`);
      return;
    }

    const signature = argumentSignature(Cmd);
    console.log(
      `\x1b[1mUsage:\x1b[0m ${Cmd.commandName}${signature ? " " + signature : ""}${(Cmd.flags ?? []).length ? " [options]" : ""}`,
    );
    if (Cmd.description) console.log(`\n${Cmd.description}`);

    if ((Cmd.args ?? []).length) {
      console.log("\n\x1b[1mArguments:\x1b[0m");
      for (const argument of Cmd.args) {
        const detail = argument.required
          ? "required"
          : argument.default !== undefined
            ? `default: ${argument.default}`
            : "optional";
        console.log(`  ${argument.name.padEnd(20)}\x1b[2m${detail}\x1b[0m`);
      }
    }

    if ((Cmd.flags ?? []).length) {
      console.log("\n\x1b[1mOptions:\x1b[0m");
      for (const flag of Cmd.flags) {
        const flagName = `--${flag.name}${flag.short ? `, -${flag.short}` : ""}`;
        const description =
          flag.description ??
          `${flag.type}${flag.default !== undefined ? ` (default: ${String(flag.default)})` : ""}`;
        console.log(`  ${flagName.padEnd(20)}\x1b[2m${description}\x1b[0m`);
      }
    }
  }
}
