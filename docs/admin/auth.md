---
title: Admin Auth Pages & Theming
description: The built-in login and profile screens, and how to restyle the panel.
---

# Auth pages

Opt in with `Panel.auth({...})` (or `Panel.configure({ auth: {...} })`). The pages
live behind the `@zerotal/admin/auth` subpath, so the `@zerotal/auth` dependency
stays optional unless you enable them.

```ts
import { Panel } from "@zerotal/admin";

Panel.auth({
  enabled: true,
  identifier: "email", // credential column
  remember: true,
  redirectTo: "/admin",
  authenticateWhen: (u) => (u as { active?: boolean }).active === true,

  // Optional — mounts the forgot/reset pages when provided:
  passwordReset: {
    sendResetLink: (email) => PasswordBroker.sendResetLink({ email }),
    reset: (input) => PasswordBroker.reset(input),
  },
  // Optional — mounts the verify page + profile banner when provided:
  emailVerification: {
    isVerified: (u) => (u as { email_verified_at?: unknown }).email_verified_at != null,
    resend: (u) =>
      (
        u as { sendEmailVerificationNotification(): Promise<void> }
      ).sendEmailVerificationNotification(),
  },
});
```

| Page                 | Route              | Uses                                            |
| -------------------- | ------------------ | ----------------------------------------------- |
| `LoginPage`          | `/login`           | `Auth.attempt` (+ remember, `authenticateWhen`) |
| `ProfilePage`        | `/profile`         | update details · change password · sign out     |
| `ForgotPasswordPage` | `/forgot-password` | `passwordReset.sendResetLink`                   |
| `ResetPasswordPage`  | `/reset-password`  | `passwordReset.reset`                           |
| `VerifyEmailPage`    | `/verify-email`    | `emailVerification.resend`                      |

Guest screens (login / forgot / reset) mount **outside** the panel guard so
unauthenticated users can reach them; profile / verify mount behind it
(override with `guestMiddleware` / `authMiddleware`). The 2FA **challenge** step is
left to your auth middleware — the rest of the flow ships here.

## Securing the panel

The panel is public until you set guard middleware. A typical setup:

```ts
Panel.configure({ middleware: [AuthMiddleware, RequireRoleMiddleware.with("admin")] });
Panel.auth({ enabled: true }); // login lives outside that guard automatically
```

## Theming

By default the panel themes everything with the **Tailwind Play CDN** plus shadcn-style
design tokens and a no-flash dark/light script — zero build step. The toggle in the
top bar flips `.dark` on `<html>` and persists the choice.

To ship a real build, point `theme.stylesheet` at your compiled CSS (the CDN is then
dropped) and reuse the exported config + tokens so your build matches the default look:

```ts
import { Panel, adminTailwindConfig, adminTokensCss } from "@zerotal/admin";

Panel.configure({
  theme: {
    stylesheet: "/assets/admin.css", // your prebuilt Tailwind output
    // cdn: true,                      // keep both during migration
    // tokensCss: ":root { --primary: 270 90% 60%; }",  // override tokens
    // noFonts: true,                  // self-host Inter
  },
});
```

`adminTailwindConfig()` returns the token→CSS-var Tailwind config and
`adminTokensCss()` the `:root`/`.dark` custom properties — feed both into your own
`tailwind.config` so a compiled stylesheet renders identically.

## Next steps

- [Admin overview](/docs/admin) — the guide's front page and the rest of the sections.
- [Reference](/docs/admin/references) — the full API surface in one table.
