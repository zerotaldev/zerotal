/**
 * `@zerotal/admin/auth` — the opt-in auth screens. Kept on a separate subpath so
 * the `@zerotal/auth` dependency these modules pull in stays optional for apps
 * that don't use the built-in auth pages. Enable them with
 * `Panel.auth({ enabled: true, ... })`; `AdminProvider` mounts the routes.
 */
export { AuthLayout } from "./AuthLayout.tsx";
export { LoginPage } from "./pages/LoginPage.tsx";
export { ProfilePage } from "./pages/ProfilePage.tsx";
export { ForgotPasswordPage } from "./pages/ForgotPasswordPage.tsx";
export { ResetPasswordPage } from "./pages/ResetPasswordPage.tsx";
export { VerifyEmailPage } from "./pages/VerifyEmailPage.tsx";
export { registerAuthRoutes } from "./register.ts";
