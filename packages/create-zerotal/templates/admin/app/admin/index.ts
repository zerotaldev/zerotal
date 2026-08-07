// Admin panel wiring. AdminProvider loads this file on boot, so every
// Panel.configure / register call below runs once at startup.
//
// This is the whole application: there is no file-based routing and no
// hand-written pages. Add a resource, register it here, and its list, view,
// create and edit pages exist.
//
// One panel is enough for most apps. If you ever need a second audience on a
// second path, `Panel.make("console", { path: "/app" })` gives you an
// independent registry that shares this one's models and sign-in.
import { Panel } from "@zerotal/admin";
import { AuthMiddleware, GuestMiddleware } from "zerotal/auth";
import { passwordReset } from "@app/auth/passwords";

import { ProductResource } from "@app/admin/ProductResource";
import { UserResource } from "@app/admin/UserResource";
import { SettingsResource } from "@app/admin/SettingsResource";
import { dashboardWidgets } from "@app/admin/widgets";

Panel.configure({
  brand: "{{name}}",
  tagline: "Admin",
  path: "/admin",
  // Every panel route is behind a signed-in session, and the guard sends people
  // to the panel's own login rather than the framework default. Without a
  // `middleware` here the panel refuses to serve outside local development —
  // it exposes full CRUD, so the safe default is closed.
  middleware: [AuthMiddleware.with({ redirectTo: "/admin/login" })],
  userMenu: {
    label: "Account",
    items: [
      { label: "Profile", href: "/admin/profile", icon: "users" },
      { label: "Settings", href: "/admin/settings", icon: "shield" },
    ],
  },
});

// The panel's own login and profile screens.
// Login and profile come with the panel. Supplying `passwordReset` is what
// mounts /admin/forgot-password and /admin/reset-password and puts the "Forgot
// your password?" link on the login screen — without it those routes do not
// exist, so the link is deliberately absent rather than dead.
Panel.auth({
  enabled: true,
  heading: "{{name}}",
  guestMiddleware: [GuestMiddleware],
  passwordReset,
});

Panel.widgets(...dashboardWidgets());

Panel.register(ProductResource, UserResource, SettingsResource);
