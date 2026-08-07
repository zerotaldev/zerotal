/**
 * Base class for model authorization policies.
 *
 * Extend this class and define methods named after the abilities you want to
 * check (view, create, update, delete, etc.). Each method receives the
 * authenticated user and the model instance.
 *
 * @remarks
 * Register the policy with {@link GateService.registerPolicy | Gate.registerPolicy}
 * (model class → policy), then check via `Gate.allows(ability, modelInstance)` /
 * `Gate.authorize(...)`, or explicitly with `Gate.via(PostPolicy).allows(...)`.
 * A method may return `boolean` or `Promise<boolean>` — for the async form use
 * `Gate.allowsAsync` / `Gate.authorizeAsync`. A missing method or a thrown error
 * resolves to a deny. For a guest, `user` is `undefined`.
 *
 * @example
 * // app/policies/PostPolicy.ts
 * export class PostPolicy extends Policy<Post> {
 *   view(_user: User | null, post: Post): boolean {
 *     return post.publishedAt !== null || _user?.id === post.userId;
 *   }
 *   update(user: User, post: Post): boolean {
 *     return user.id === post.userId;
 *   }
 *   delete(user: User, post: Post): boolean {
 *     return user.id === post.userId || user.role === 'admin';
 *   }
 * }
 */

export abstract class Policy<_Model = unknown> {}
