/**
 * Auth-route registrar. Dynamically imported by `AdminProvider` only when
 * `Panel.auth({ enabled: true })` is set, so the hard `@zerotal/auth` dependency
 * (pulled in by the page modules) stays out of the always-loaded path.
 *
 * Guest screens (login + optional password reset) mount OUTSIDE the panel guard
 * so unauthenticated users can reach them; profile + verify mount behind the
 * auth guard (defaults to the panel's middleware).
 */
import { Router } from "@zerotal/core";
import type { MiddlewareClass } from "@zerotal/core";
import { Panel } from "../Panel.ts";
import { LoginPage } from "./pages/LoginPage.tsx";
import { ProfilePage } from "./pages/ProfilePage.tsx";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage.tsx";
import { ResetPasswordPage } from "./pages/ResetPasswordPage.tsx";
import { VerifyEmailPage } from "./pages/VerifyEmailPage.tsx";

type FlowFn = (p: string, page: unknown, mw?: MiddlewareClass[]) => unknown;

export function registerAuthRoutes(path: string, panelGuard: MiddlewareClass[]): void {
  const cfg = Panel.authConfig();
  if (!cfg) return;
  const flow = (Router as unknown as { flow?: FlowFn }).flow;
  if (typeof flow !== "function") return;

  const loginPath = cfg.loginPath ?? "/login";
  const profilePath = cfg.profilePath ?? "/profile";
  const guestGuard = cfg.guestMiddleware ?? [];
  const authGuard = cfg.authMiddleware ?? panelGuard;

  Router.group({ prefix: path, middleware: guestGuard }, () => {
    flow(loginPath, LoginPage);
    if (cfg.passwordReset) {
      flow("/forgot-password", ForgotPasswordPage);
      flow("/reset-password", ResetPasswordPage);
    }
  });

  Router.group({ prefix: path, middleware: authGuard }, () => {
    flow(profilePath, ProfilePage);
    if (cfg.emailVerification) flow("/verify-email", VerifyEmailPage);
  });
}
