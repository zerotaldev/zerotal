import { view } from "zerotal";
import type { HttpContext } from "zerotal";
import { Auth, AuthMiddleware } from "zerotal/auth";
import { validate } from "zerotal/validator";
import { User } from "@app/models/User.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "../../config/i18n.ts";
import { activeTheme } from "../../bootstrap/app.ts";
import { AppLayout } from "../../resources/views/layouts/AppLayout.tsx";
import { Card, Field, PageHeader, buttonClass } from "../../resources/views/components/Ui.tsx";
import {
  GlobeIcon,
  ShieldIcon,
  SunIcon,
  UserIcon,
} from "../../resources/views/components/Icons.tsx";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

/**
 * The four settings sections, in the order the Inertia build lists them.
 *
 * `id` doubles as the `?section=` value, so a tab is a URL. That is the entire
 * mechanism — see the note on `GET` below.
 */
const SECTIONS = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "security", label: "Security", icon: ShieldIcon },
  { id: "appearance", label: "Appearance", icon: SunIcon },
  // Its own section rather than a card inside Appearance. Language is not a
  // theme, and nobody hunting for it opens something called "Appearance".
  { id: "language", label: "Language", icon: GlobeIcon },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function activeSection(http: HttpContext): SectionId {
  const requested = http.url.searchParams.get("section") ?? "";
  const known = SECTIONS.find((section) => section.id === requested);
  return known?.id ?? "profile";
}

/**
 * GET /profile — the same four tabs, switched by navigating rather than by state.
 *
 * The Inertia build holds the selected tab in `useState` and swaps the panel in
 * place. There is no state here and no listener to change it, so the tab lives
 * in the URL: each one is a link to `?section=…`, and the server renders the
 * panel that was asked for. `/profile?section=security` is now a page someone
 * can bookmark, link to, and reach with the back button — which the stateful
 * version is not.
 *
 * The markup is a `<nav>` of links rather than `role="tablist"` with
 * `role="tab"`, and that is deliberate. The ARIA tab pattern promises arrow-key
 * navigation and a roving tabindex, both of which need a script; claiming the
 * role without them tells a screen-reader user to expect behaviour that is not
 * there. These are links, so they are announced as links, and `aria-current`
 * says which one you are on.
 */
export const GET = async (http: HttpContext) => {
  const user = Auth.user() as User;
  const section = activeSection(http);
  const errors = http.session?.get<Record<string, string>>("errors") ?? {};
  const old = http.session?.get<Record<string, string>>("old") ?? {};
  const theme = activeTheme();

  view(
    <AppLayout
      title={__("Profile")}
      active="profile"
      user={{ name: user.name, email: user.email }}
      flash={{
        success: http.session?.get<string>("success") ?? null,
        error: http.session?.get<string>("error") ?? null,
      }}
    >
      <div class="max-w-4xl space-y-6">
        <PageHeader
          title={__("Profile")}
          description={__("Manage your personal information, security and preferences.")}
        />

        <div class="grid gap-6 md:grid-cols-[180px_minmax(0,1fr)] md:gap-8">
          <nav
            aria-label={__("Settings sections")}
            class="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0"
          >
            {SECTIONS.map(({ id, label, icon: Icon }) => {
              const selected = id === section;
              return (
                <a
                  href={`${route("profile")}?section=${id}`}
                  aria-current={selected ? "page" : undefined}
                  class={
                    "flex h-9 shrink-0 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors duration-150 " +
                    (selected
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground")
                  }
                >
                  <Icon
                    class={`size-4 shrink-0 ${selected ? "text-primary" : "text-current"}`}
                  />
                  {__(label)}
                </a>
              );
            })}
          </nav>

          <div>
            {section === "profile" ? (
              <Card class="p-5">
                <h2 class="text-[0.9375rem] font-semibold">{__("Personal information")}</h2>
                <p class="mt-1 text-sm text-muted-foreground">
                  {__("Update your name and email address.")}
                </p>

                <form method="post" action={route("profile.store")} class="mt-5 space-y-5">
                  <Field
                    label={__("Name")}
                    name="name"
                    value={old["name"] ?? user.name}
                    error={errors["name"]}
                    autocomplete="name"
                    required
                  />
                  <Field
                    label={__("Email")}
                    name="email"
                    type="email"
                    value={old["email"] ?? user.email}
                    error={errors["email"]}
                    autocomplete="email"
                    required
                  />
                  <div class="flex justify-end border-t border-border pt-5">
                    <button type="submit" class={buttonClass("primary")}>
                      {__("Save changes")}
                    </button>
                  </div>
                </form>
              </Card>
            ) : null}

            {section === "security" ? (
              <Card class="p-5">
                <h2 class="text-[0.9375rem] font-semibold">{__("Password")}</h2>
                <p class="mt-1 text-sm text-muted-foreground">
                  {__("Choose a strong password for your account.")}
                </p>

                <form
                  method="post"
                  action={route("profile.password.store")}
                  class="mt-5 space-y-5"
                >
                  <Field
                    label={__("Current password")}
                    name="current_password"
                    type="password"
                    error={errors["current_password"]}
                    autocomplete="current-password"
                    required
                  />
                  <Field
                    label={__("New password")}
                    name="password"
                    type="password"
                    error={errors["password"]}
                    hint={__("At least 8 characters.")}
                    autocomplete="new-password"
                    required
                  />
                  <Field
                    label={__("Confirm new password")}
                    name="password_confirmation"
                    type="password"
                    autocomplete="new-password"
                    required
                  />
                  <div class="flex justify-end border-t border-border pt-5">
                    <button type="submit" class={buttonClass("primary")}>
                      {__("Update password")}
                    </button>
                  </div>
                </form>
              </Card>
            ) : null}

            {section === "appearance" ? (
              <Card class="p-5">
                <h2 class="text-[0.9375rem] font-semibold">{__("Theme")}</h2>
                <p class="mt-1 text-sm text-muted-foreground">
                  {__("Light or dark. The choice is stored in a cookie, so the server can apply it before the page renders.")}
                </p>

                {/* Two submit buttons in one form, distinguished by `value`. A
                    toggle would need a script to know which way it was going;
                    two buttons say what they do and need nothing. */}
                <form method="post" action={route("profile.appearance.store")} class="mt-5 flex gap-2">
                  <button
                    type="submit"
                    name="theme"
                    value="light"
                    aria-pressed={theme === "light" ? "true" : "false"}
                    class={buttonClass(theme === "light" ? "primary" : "secondary")}
                  >
                    {__("Light")}
                  </button>
                  <button
                    type="submit"
                    name="theme"
                    value="dark"
                    aria-pressed={theme === "dark" ? "true" : "false"}
                    class={buttonClass(theme === "dark" ? "primary" : "secondary")}
                  >
                    {__("Dark")}
                  </button>
                </form>
              </Card>
            ) : null}

            {section === "language" ? (
              <Card class="p-5">
                <h2 class="text-[0.9375rem] font-semibold">{__("Language")}</h2>
                <p class="mt-1 text-sm text-muted-foreground">
                  {__("Applies to the interface and to messages the server sends you.")}
                </p>

                {/* A submit button rather than a `<select onChange>`: without a
                    script nothing can post the form for you, and a select that
                    silently does nothing is worse than one with a button. */}
                <form
                  method="post"
                  action={route("profile.locale.store")}
                  class="mt-5 flex items-end gap-2"
                >
                  <div class="space-y-1.5">
                    <label for="locale" class="block text-sm font-medium text-foreground">
                      {__("Language")}
                    </label>
                    <select
                      id="locale"
                      name="locale"
                      class="h-10 rounded-md border border-input bg-card px-2 text-sm text-foreground focus:border-ring focus:ring-2 focus:ring-ring/15 focus:outline-none"
                    >
                      {SUPPORTED_LOCALES.map((code) => (
                        <option value={code} selected={user.locale === code}>
                          {LOCALE_NAMES[code] ?? code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" class={buttonClass("primary")}>
                    {__("Save changes")}
                  </button>
                </form>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </AppLayout>,
  );
};

/**
 * POST /profile — name and email.
 *
 * Byte-for-byte the same rules and the same conflict check as the Inertia build,
 * because they are the same route in the recipe — only the render differs.
 */
export async function POST(http: HttpContext): Promise<void> {
  const user = Auth.user() as User;

  const { name, email } = await validate(http, (r) => ({
    name: r.string().trim().min(2).max(80),
    email: r.string().trim().email(),
  }));

  // Someone else holding this address is the only conflict — keeping your own
  // is not a change at all.
  const taken = await User.query().where("email", email).first();
  if (taken && taken.id !== user.id) {
    http.flash("error", __("That email is already in use."));
    http.redirect(route("profile"), 303);
    return;
  }

  user.name = name;
  user.email = email;
  await user.save();

  http.flash("success", __("Details saved."));
  http.redirect(route("profile"), 303);
}
