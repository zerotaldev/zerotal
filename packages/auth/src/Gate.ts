import { createFacade } from "@zerotal/core";
import "./augment.ts"; // ensure ContainerBindings['gate'] is in scope

/**
 * The `Gate` facade — model authorization, backed by {@link GateService}.
 *
 * @remarks
 * Resolves the `gate` binding from the container, so it is usable only after
 * `app.boot()`. It routes an ability check through, in order: `before` hooks
 * (e.g. a super-admin bypass), closure abilities registered with
 * {@link GateService.defineAbility | defineAbility}, a {@link Policy} registered
 * for the model's class via {@link GateService.registerPolicy | registerPolicy},
 * and finally the user's own relational permissions (`user.can(ability)`).
 *
 * Use {@link GateService.allows | allows} for a boolean and
 * {@link GateService.authorize | authorize} to throw on denial. For abilities
 * that hit the database, use the `*Async` variants — the sync forms treat a
 * returned Promise as truthy and would wrongly allow.
 *
 * @example
 * ```ts
 * import { Gate } from '@zerotal/auth';
 * import { Post } from '../models/Post.ts';
 * import { PostPolicy } from '../policies/PostPolicy.ts';
 *
 * // Register a policy for a model class (typically at boot):
 * Gate.registerPolicy(Post, PostPolicy);
 *
 * // Define an ad-hoc ability (no model needed):
 * Gate.defineAbility('update-post', (user, post) => user?.id === post.userId);
 *
 * // Check in a controller:
 * Gate.allows('update-post', post);   // boolean
 * Gate.authorize('delete', post);      // throws ForbiddenError when denied
 *
 * // Explicit policy form:
 * Gate.via(PostPolicy).allows('update', post);
 * ```
 */
export const Gate = createFacade("gate");
