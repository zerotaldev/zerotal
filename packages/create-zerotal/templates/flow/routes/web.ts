import { Router } from "zerotal";

import { middleware as guest } from "../app/routes/(guest)/_middleware";
import { middleware as signedIn } from "../app/routes/(auth)/_middleware";
import { middleware as verified } from "../app/routes/(auth)/(verified)/_middleware";
import { middleware as passkeySettings } from "../app/routes/(auth)/settings/passkeys/_middleware";
import { middleware as twoFactorSettings } from "../app/routes/(auth)/settings/two-factor/_middleware";

import { AboutPage } from "../app/flow/pages/about";
import { HomePage } from "../app/flow/pages/home";
import { ConfirmPasswordPage } from "../app/flow/pages/auth/confirm-password";
import { ForgotPasswordPage } from "../app/flow/pages/auth/forgot-password";
import { LoginPage } from "../app/flow/pages/auth/login";
import { RegisterPage } from "../app/flow/pages/auth/register";
import { ResetPasswordPage } from "../app/flow/pages/auth/reset-password";
import { TwoFactorChallengePage } from "../app/flow/pages/auth/two-factor-challenge";
import { VerifyEmailPage } from "../app/flow/pages/auth/verify-email";
import { DashboardPage } from "../app/flow/pages/dashboard";
import { CreateProjectPage } from "../app/flow/pages/projects/create";
import { EditProjectPage } from "../app/flow/pages/projects/edit";
import { ProjectsPage } from "../app/flow/pages/projects/index";
import { AppearancePage } from "../app/flow/pages/settings/appearance";
import { DeleteAccountPage } from "../app/flow/pages/settings/delete-account";
import { PasskeysPage } from "../app/flow/pages/settings/passkeys";
import { PasswordPage } from "../app/flow/pages/settings/password";
import { ProfilePage } from "../app/flow/pages/settings/profile";
import { SessionsPage } from "../app/flow/pages/settings/sessions";
import { TwoFactorPage } from "../app/flow/pages/settings/two-factor";

/**
 * Every page of the app: its URL, its route name and who may see it.
 *
 * A page is a Flow component in app/flow/pages/. What its forms send — the POST, PUT,
 * PATCH and DELETE handlers — and the JSON endpoints behind passkeys and social sign-in
 * live in app/routes/, where the file path is the URL. The two meet at the same URLs:
 * GET /login is `LoginPage` below, POST /login is app/routes/(guest)/login.ts.
 *
 * Who may visit is decided once, by the `_middleware.ts` files in app/routes/. The
 * groups below import those same lists, so a page and the form it posts to are always
 * guarded alike.
 *
 * Names are set on every page, so `route("projects.edit", { project: 1 })` reads the
 * same however the page is registered.
 */

// Public.
Router.flow("/", HomePage).name("home");
Router.flow("/about", AboutPage).name("about");

// Signing in — for visitors who are not signed in yet.
Router.group({ middleware: guest }, () => {
  Router.flow("/login", LoginPage).name("login");
  Router.flow("/register", RegisterPage).name("register");
  Router.flow("/forgot-password", ForgotPasswordPage).name("forgot-password");
  Router.flow("/reset-password", ResetPasswordPage).name("reset-password");
  Router.flow("/two-factor/challenge", TwoFactorChallengePage).name("two-factor.challenge");
});

// Signed in.
Router.group({ middleware: signedIn }, () => {
  Router.flow("/verify-email", VerifyEmailPage).name("verify-email");
  Router.flow("/confirm-password", ConfirmPasswordPage).name("confirm-password");

  // Settings work before the email address is confirmed, so a mistyped one can be fixed.
  Router.flow("/settings/profile", ProfilePage).name("settings.profile");
  Router.flow("/settings/password", PasswordPage).name("settings.password");
  Router.flow("/settings/appearance", AppearancePage).name("settings.appearance");
  Router.flow("/settings/sessions", SessionsPage).name("settings.sessions");
  Router.flow("/settings/delete-account", DeleteAccountPage).name("settings.delete-account");
  Router.group({ middleware: twoFactorSettings }, () => {
    Router.flow("/settings/two-factor", TwoFactorPage).name("settings.two-factor");
  });
  Router.group({ middleware: passkeySettings }, () => {
    Router.flow("/settings/passkeys", PasskeysPage).name("settings.passkeys");
  });

  // …and a confirmed email address.
  Router.group({ middleware: verified }, () => {
    Router.flow("/dashboard", DashboardPage).name("dashboard");
    Router.flow("/projects", ProjectsPage).name("projects");
    Router.flow("/projects/create", CreateProjectPage).name("projects.create");
    Router.flow("/projects/:project/edit", EditProjectPage).name("projects.edit");
  });
});
