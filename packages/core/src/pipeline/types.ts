/**
 * Shared types for the middleware pipeline: the `next` callback, the controller
 * handler return type, the `Pipe` contract, and the response-carrying payload.
 */

/**
 * Passes control to the rest of the pipeline and resolves with the `Response`
 * produced downstream (or `undefined` when nothing deeper has set one yet —
 * the controller may not have run, or a deeper pipe short-circuited with void).
 *
 * Always guard the result before touching it:
 *
 *   const res = await next();
 *   if (res) res.headers.get('…');   // res is Response | undefined
 */
export type NextFn = () => Promise<Response | void>;

/**
 * Return type for controller handler methods.
 *
 * Equivalent to `Promise<void>` but communicates intent — a handler either
 * returns nothing (side-effect already set on ctx) or a ResponseBuilder from
 * a redirect helper (redirect(), redirect().back(), etc.). Because ResponseBuilder
 * implements PromiseLike<void>, TypeScript unwraps it to void automatically,
 * so all IFRS helpers work without changing this type.
 *
 * @example
 * async store(ctx: HttpContext): HttpResponse {
 *   const data = await StorePostRequest.validate();
 *   const post  = await Post.create(data);
 *   return redirect(`/posts/${post.id}`, 303).withSuccess('Post created.');
 * }
 *
 * async showLogin(ctx: HttpContext): HttpResponse {
 *   return inertia('Auth/Login');
 * }
 */
export type HttpResponse = Promise<void>;

/**
 * A single step in a middleware pipeline.
 *
 * ## Contract
 * A pipe does exactly one of three things:
 * - **Continue:** `return next()` to run the rest of the chain.
 * - **Short-circuit:** produce a `Response` and stop. Either `return` it
 *   directly, or set `ctx.response` and `return` (void). Do NOT call `next()`.
 * - **Wrap:** `const res = await next()`, inspect/transform `res`, then return
 *   the (possibly new) `Response` — or just mutate `ctx.response` and return void.
 *
 * `ctx.response` is the canonical store: returning a `Response` is sugar the
 * pipeline mirrors onto it, and a `void` return leaves it untouched (so it can
 * never erase a response a deeper pipe already set).
 *
 * @example
 * class RequireAuth implements Pipe<HttpContext> {
 *   async handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
 *     if (!ctx.user) {
 *       return Response.json({ message: 'Unauthenticated.' }, { status: 401 });
 *     }
 *     return next();
 *   }
 * }
 */
export interface Pipe<T> {
  handle(payload: T, next: NextFn): Promise<Response | void>;
}

/**
 * HttpContext carries the Response when a controller sets it.
 * Pipes that produce a response set ctx.response and return ctx.
 * The pipeline terminal in Application.ts reads ctx.response.
 */
/**
 * A payload that can carry a `Response`. Pipes set `response` and return the
 * payload to short-circuit; the pipeline terminal reads it back.
 *
 * @internal
 */
export interface HasResponse {
  response: Response | undefined;
}
