/**
 * The `@zerotal/core/facades` subpath — the framework's static-style facades.
 *
 * A facade is a thin, always-safe-to-import handle over a named container
 * binding: every property access resolves the live instance from the running
 * application on demand, so facades hold no module-level state and stay correct
 * across boots. {@link App} reaches the application kernel and IoC container,
 * {@link Config} reads configuration, {@link Events} emits framework events, and
 * {@link Artisan} runs registered CLI commands in-process. All of them require
 * `Application.create()` (and, for resolution, `boot()`) to have run first.
 *
 * @example
 * ```ts
 * import { App, Config, Events, Artisan } from "@zerotal/core/facades";
 *
 * const name = Config.get("app.name");
 * const users = await App.make("users");
 * await Events.emit(new UserRegistered(user.id));
 * const { code, output } = await Artisan.call("cache:clear");
 * ```
 *
 * @packageDocumentation
 */
export { App } from "./App.ts";
export { Config } from "./Config.ts";
export { Events } from "./Events.ts";
export { Artisan } from "./Artisan.ts";
export type { ArtisanResult } from "./Artisan.ts";
