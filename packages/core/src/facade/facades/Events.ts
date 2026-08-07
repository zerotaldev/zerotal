/**
 * The `Events` facade — static-style access to the application event emitter
 * registered under the container's `events` binding.
 */
import { createFacade } from "../Facade.ts";

/**
 * Facade over the `events` binding ({@link Emitter}) for emitting events and
 * registering listeners.
 *
 * @example
 * ```ts
 * import { Events } from "@zerotal/core/facades";
 *
 * Events.on(UserRegistered, SendWelcomeEmail);
 * await Events.emit(new UserRegistered(user.id, user.email));
 * ```
 */
export const Events = createFacade("events");
