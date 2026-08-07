/**
 * The `Artisan` facade — runs registered CLI commands from inside a running
 * application and captures their output instead of writing to the terminal.
 */
import { currentApp } from "../../application/currentApp.ts";
import type { CommandRunner } from "../../command/CommandRunner.ts";

/** Outcome of running a command through {@link Artisan}. */
export interface ArtisanResult {
  /** Process-style exit code: 0 = success, non-zero = failure. */
  code: number;
  /** Everything the command wrote via info/error/warn/etc. */
  output: string;
}

/**
 * Artisan facade — run any registered command from inside the application.
 * Output is captured; nothing is written to the server terminal.
 * Safe to call from controllers, services, scheduled tasks.
 *
 * Only use for fast commands. For long-running work, use Bun.spawn or worker.ts.
 *
 * See: plans/boot-modes.md §6
 *
 * @throws {Error} From {@link Artisan.call} when no CommandRunner is registered
 * in the container (commands are only registered for `env='web'`).
 *
 * @example
 * ```ts
 * const { code, output } = await Artisan.call('cache:clear');
 * const { code, output } = await Artisan.call('migrate', { '--fresh': true });
 * return Response.json({ output, success: code === 0 });
 * ```
 */
export const Artisan = {
  async call(
    commandName: string,
    parameters: Record<string, string | boolean | number> = {},
  ): Promise<ArtisanResult> {
    const container = currentApp().container;
    const runner = container.tryMake("commands") as CommandRunner | undefined;

    if (!runner) {
      throw new Error(
        `Artisan.call('${commandName}') failed: no CommandRunner in container. ` +
          `Register commands in AppServiceProvider.onBooted() for env='web'.`,
      );
    }

    // Booleans become bare flags (only when true); everything else becomes a
    // `key=value` token, mirroring how the CLI parses argv.
    const commandArguments = [commandName];
    for (const [key, value] of Object.entries(parameters)) {
      if (typeof value === "boolean") {
        if (value) commandArguments.push(key);
      } else {
        commandArguments.push(`${key}=${String(value)}`);
      }
    }

    return runner.callInProcess(commandArguments);
  },
};
