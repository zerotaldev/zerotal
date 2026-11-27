/**
 * Which process of `zt dev` this is, for a provider that should act in only one of them.
 *
 * `zt dev` boots the app in its own process to ask what to run, then starts the server as a
 * child, once per restart. A provider that serves pages has nothing to do in the first, and a
 * provider that prints a banner says it once rather than on every save.
 *
 * @module
 */
import { _isDevCommand } from "../conventions/ConventionLoader.ts";
import { _DEV_BOOT_ID_VAR } from "./reloadClient.ts";

/**
 * Whether this is the `zt dev` process itself, which serves no pages: it boots the app only to
 * collect the dev processes, then supervises the server it spawns.
 *
 * @param args - The command line after the script. Defaults to this process's.
 * @internal
 */
export function _isDevParent(args: readonly string[] = Bun.argv.slice(2)): boolean {
  return _isDevCommand(args);
}

/**
 * Whether this is a server `zt dev` restarted, rather than the first one it started.
 *
 * @param env - The environment to read the boot id from.
 * @internal
 */
export function _isDevRestart(env: Record<string, string | undefined> = Bun.env): boolean {
  const boot = env[_DEV_BOOT_ID_VAR];
  return boot !== undefined && !boot.endsWith("-1");
}
