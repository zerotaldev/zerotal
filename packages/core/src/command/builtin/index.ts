/**
 * Built-in CLI commands shipped with Zerotal, published as the
 * `@zerotal/core/commands` subpath.
 *
 * These are the command classes the framework registers automatically during
 * {@link CommandRunner.boot} — the `make:*` scaffolders, `serve`/`worker`
 * process launchers, and diagnostics like `status`, `reload`, and `route:list`.
 * They are all subclasses of the {@link Command} base class and are invoked
 * through the scaffolded app's CLI entry point, `zt.ts`, as `bun zt <command>`.
 *
 * Which commands are available depends on the boot mode: `serve`, `reload`,
 * `status`, and `route:list` are registered in every environment, while the
 * scaffolding and worker commands are only registered outside `web` mode.
 *
 * @example
 * ```bash
 * # Start the dev server
 * bun zt serve --dev
 *
 * # Scaffold a controller and list the registered routes
 * bun zt make:controller PostController --resource
 * bun zt route:list
 * ```
 *
 * @packageDocumentation
 */
export { ServeCommand } from "./ServeCommand.ts";
export { DevCommand } from "./DevCommand.ts";
export { ReplCommand } from "./ReplCommand.ts";
export { StartCommand } from "./StartCommand.ts";
export { WorkerCommand } from "./WorkerCommand.ts";
export { CompileCommand } from "./CompileCommand.ts";
export { KeyGenerateCommand } from "./KeyGenerateCommand.ts";
export { ReloadCommand } from "./ReloadCommand.ts";
export { StatusCommand } from "./StatusCommand.ts";
export { MakeControllerCommand } from "./MakeControllerCommand.ts";
export { MakeMiddlewareCommand } from "./MakeMiddlewareCommand.ts";
export { MakeCommandCommand } from "./MakeCommandCommand.ts";
export { MakeRequestCommand } from "./MakeRequestCommand.ts";
export { MakeEventCommand } from "./MakeEventCommand.ts";
export { MakeListenerCommand } from "./MakeListenerCommand.ts";
export { MakeJobCommand } from "./MakeJobCommand.ts";

export { MakePolicyCommand } from "./MakePolicyCommand.ts";
export { MakeNotificationCommand } from "./MakeNotificationCommand.ts";
export { MakeObserverCommand } from "./MakeObserverCommand.ts";
export { MakeResourceCommand } from "./MakeResourceCommand.ts";
export { MakeTestCommand } from "./MakeTestCommand.ts";
export { TestCommand } from "./TestCommand.ts";
export { RouteListCommand } from "./RouteListCommand.ts";
export { RouteTypesCommand } from "./RouteTypesCommand.ts";
export { DoctorCommand } from "./DoctorCommand.ts";
export { UpgradeCommand } from "./UpgradeCommand.ts";
export { DeployCommand, makeDeployCommand } from "./DeployCommand.ts";
export { MakeProviderCommand } from "./MakeProviderCommand.ts";
export { CssBuildCommand } from "./CssBuildCommand.ts";
export { AssetsBuildCommand } from "./AssetsBuildCommand.ts";
export { AssetsPruneCommand } from "./AssetsPruneCommand.ts";
export { LintPackagesCommand } from "./LintPackagesCommand.ts";
export { MakePackageCommand } from "./MakePackageCommand.ts";
