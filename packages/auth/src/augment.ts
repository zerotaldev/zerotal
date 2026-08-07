import type { AuthUser } from "./AuthUser.ts";
import type { Policy } from "./Policy.ts";
import type { GateService } from "./GateService.ts";
import type { TwoFactorService } from "./TwoFactorService.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    /** Authorization service — registered by AuthProvider. */
    gate: GateService;
    /** Two-factor authentication service — registered by AuthProvider. */
    two_factor: TwoFactorService;
    /** User loader used by AuthMiddleware. Bind this instead of calling setLoader(). */
    "auth.userLoader": (id: number) => Promise<AuthUser | null>;
  }

  interface HttpContext {
    /** The authenticated user for this request, populated by AuthMiddleware. */
    user?: AuthUser | undefined;

    /**
     * Assert the current user is authorized. Throws a 403 ForbiddenError if
     * the policy method returns false.
     *
     * @example
     * await ctx.authorize(PostPolicy, 'update', post);
     */
    authorize<M>(PolicyClass: new () => Policy<M>, ability: string, model?: M): Promise<void>;
  }
}

export {};
