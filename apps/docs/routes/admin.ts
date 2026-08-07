import { Router, ThrottleMiddleware, env } from "zerotal";
import { Auth, AuthMiddleware, GuestMiddleware } from "zerotal/auth";
import { LoginPage } from "@app/admin/LoginPage.tsx";
import { PostsPage } from "@app/admin/PostsPage.tsx";
import { PostEditorPage } from "@app/admin/PostEditorPage.tsx";

// Flow middleware is persistent: it re-runs on the initial GET *and* on every
// WebSocket update, so a session that expires mid-edit is caught on the next
// action rather than only on the next page load.
const guard = AuthMiddleware.with({ redirectTo: "/admin/login" });

/**
 * Rate limit on the sign-in page. Flow middleware is persistent, so this counts
 * the initial GET *and* every WebSocket action — which is what makes it a limit
 * on password attempts rather than only on page loads.
 *
 * `TRUSTED_PROXIES` matters once this is deployed: `X-Forwarded-For` is
 * client-writable, so the limiter keys on the unspoofable socket address unless
 * told how many proxies sit in front. Left unset, every visitor behind a load
 * balancer would otherwise share one bucket.
 */
const loginThrottle = ThrottleMiddleware.with({
  maxAttempts: 10,
  windowSeconds: 300,
  trustedProxies: Number(env("TRUSTED_PROXIES", "0")),
});

Router.flow("/admin/login", LoginPage, [
  GuestMiddleware.with({ redirectTo: "/admin" }),
  loginThrottle,
]);

Router.group({ middleware: [guard] }, () => {
  Router.flow("/admin", PostsPage).name("admin.posts");
  Router.flow("/admin/posts/new", PostEditorPage).name("admin.posts.new");
  // `:post` resolves to a Post by slug (Post.resolveRouteBinding) and @param
  // seeds it onto the page — the editor never looks up its own subject.
  Router.flow("/admin/posts/:post/edit", PostEditorPage).name("admin.posts.edit");
});

// A plain form post, not a Flow action: signing out ends the session that Flow's
// WebSocket authenticates with, so it wants an ordinary request/response.
Router.post("/admin/logout", async (ctx) => {
  await Auth.logout();
  ctx.redirect("/admin/login", 303);
});
