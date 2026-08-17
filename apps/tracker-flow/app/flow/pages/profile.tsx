import { Component, expose, locked, url, validate } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Auth, AuthMiddleware, Hash } from "zerotal/auth";
import { User } from "@app/models/User.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "../../../config/i18n.ts";
import { THEMES, activeTheme } from "../../../bootstrap/app.ts";
import { AppLayout } from "../layouts/app.tsx";
import { CARD, ERROR, FIELD, LABEL, PRIMARY, SECONDARY, SELECT } from "../ui.ts";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

/**
 * The four sections, in the order the other two builds list them.
 *
 * `id` doubles as the `?section=` value, so a tab is still a URL.
 */
const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Security" },
  { id: "appearance", label: "Appearance" },
  // Its own section rather than a card inside Appearance. Language is not a
  // theme, and nobody hunting for it opens something called "Appearance".
  { id: "language", label: "Language" },
] as const;

/**
 * GET /profile — the four settings sections, as real tabs.
 *
 * This is the page that was supposed to use Flow's `<Tabs>`, and it does not.
 * Two things stop it, both visible rather than theoretical:
 *
 *  1. **Selection is client-only and unaddressable.** `<Tabs>` holds the active
 *     tab in `x-data="flowTabs({tab})"`, always starts on the first item, and
 *     exposes no prop to bind or read it. `/profile?section=security` — a URL
 *     the other two builds both serve — cannot exist, and neither can the back
 *     button. That is the exact trade the Inertia build's `useState` made and
 *     the view build refused; adopting it here would make this the *least*
 *     addressable of the three.
 *  2. **The tab strip is not themeable.** It emits `border-gray-800`,
 *     `text-white` and `border-indigo-500` inline, and only the outer wrapper
 *     takes a `class`. In this app's light theme the selected tab is white text
 *     on a white card — invisible — and the accent is indigo where everything
 *     else is the primary token.
 *
 * So the strip is written out here: `@url`-synced with `history: "push"`, styled
 * from the same vocabulary as every other control, and carrying the same ARIA
 * `<Tabs>` does — `role="tablist"`/`"tab"`/`"tabpanel"`, `aria-selected`,
 * `aria-controls`, and a roving `tabindex` with Left/Right/Home/End moving
 * between tabs. The keyboard handling costs one action; the addressability and
 * the theme are worth it.
 *
 * `<Tabs>` growing a bindable selection and token-neutral classes would let this
 * page delete forty lines. Until then, the built-in is the wrong tool for a page
 * that has to be linkable.
 */
export class ProfilePage extends Component {
  static layout = AppLayout;
  static title = "Profile";

  @url({ as: "section", history: "push" }) section = "profile";

  @locked email = "";
  @locked locale = "";
  @locked theme = "light";

  @expose @validate((r) => r.required().min(2).max(80)) name = "";
  @expose @validate((r) => r.required().email()) emailInput = "";

  @expose currentPassword = "";
  @expose @validate((r) => r.required().min(8).confirmed()) password = "";
  @expose password_confirmation = "";

  override async onMount(): Promise<void> {
    const user = Auth.user() as User;
    this.name = user.name;
    this.emailInput = user.email;
    this.email = user.email;
    this.locale = user.locale ?? "";
    this.theme = activeTheme();
  }

  /**
   * Name and email — byte-for-byte the other builds' rules and conflict check.
   */
  @expose async saveDetails(): Promise<void> {
    await this.validate({
      name: (r) => r.string().trim().min(2).max(80),
      emailInput: (r) => r.string().trim().email(),
    });

    const user = Auth.user() as User;

    // Someone else holding this address is the only conflict — keeping your own
    // is not a change at all.
    const taken = await User.query().where("email", this.emailInput).first();
    if (taken && taken.id !== user.id) {
      this.addError("emailInput", __("That email is already in use."));
      return;
    }

    user.name = this.name;
    user.email = this.emailInput;
    await user.save();
    this.email = user.email;

    this.flash(__("Details saved."));
  }

  /**
   * The password, changed without leaving the tab.
   *
   * The other two builds POST to `/profile/password` and redirect back to
   * `?section=security`, because a redirect is the only way a form can answer
   * and the section would otherwise be lost. Here the action returns to the same
   * live page, so there is nothing to preserve and no second route to own it.
   */
  @expose async changePassword(): Promise<void> {
    await this.validate({
      currentPassword: (r) => r.string().min(1),
      password: (r) => r.string().min(8).confirmed(),
    });

    const user = Auth.user() as User;

    // Proving the current password is what stops a borrowed session from locking
    // the real owner out of their own account.
    if (!(await Hash.check(this.currentPassword, user.password))) {
      this.addError("currentPassword", __("Your current password is not correct."));
      return;
    }

    user.password = await Hash.make(this.password);
    await user.save();

    this.currentPassword = "";
    this.password = "";
    this.password_confirmation = "";
    this.flash(__("Password updated."));
  }

  /**
   * Light or dark — written to a cookie *and* applied to the live page.
   *
   * Two mechanisms because they answer two different moments. `this.client()`
   * flips the class on the wrapper immediately, with no reload — the thing the
   * view build cannot do. The cookie is what makes the *next* request's first
   * paint correct, because the layout reads it before any markup is written.
   * Writing only one of the two gives either a page that snaps back on reload or
   * one that needs a reload to change at all.
   *
   * A cookie rather than the user row, unlike the locale: a theme belongs to the
   * screen you are reading on, not to the account.
   */
  @expose setTheme(theme: string): void {
    if (!(THEMES as readonly string[]).includes(theme)) return;
    this.theme = theme;

    this.client(
      `document.cookie = ${JSON.stringify(`theme=${theme}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`)};` +
        `document.querySelector('[lang]')?.classList.toggle('dark', ${theme === "dark"})`,
    );
  }

  /**
   * The language, stored on the account.
   *
   * The acceptable values are `SUPPORTED_LOCALES` — a locale is the name of a
   * catalog file, so accepting one the app cannot load would leave every string
   * silently falling back.
   *
   * A redirect rather than a patch, and that is the interesting part: `__()`
   * resolved against the *old* locale everywhere on this page before the action
   * ran, and the i18n context is established by middleware on a request. Patching
   * would leave a page half-translated. So the page is reloaded through the
   * middleware that can read the new choice.
   */
  @expose async setLocale(locale: string): Promise<void> {
    if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) return;

    const user = Auth.user() as User;
    user.locale = locale;
    await user.save();

    this.client(
      `document.cookie = ${JSON.stringify(`locale=${locale}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`)}`,
    );

    // Said in the language just chosen, which is the confirmation: if this
    // sentence arrives in the old language, the change did not take.
    this.redirect("/profile?section=language").withSuccess(__("Language updated.", {}, locale));
  }

  private detailsPanel(): HtmlNode {
    return (
      <div class={`${CARD} p-5`}>
        <h2 class="text-[0.9375rem] font-semibold">{__("Personal information")}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{__("Update your name and email address.")}</p>

        <form onSubmit={this.saveDetails} class="mt-5 space-y-5">
          <div class="space-y-1.5">
            <label class={LABEL} for="name">
              {__("Name")}
            </label>
            <input id="name" autocomplete="name" required class={FIELD} value={this.name} />
            <span error={this.errors.name} class={ERROR} />
          </div>

          <div class="space-y-1.5">
            <label class={LABEL} for="emailInput">
              {__("Email")}
            </label>
            <input
              id="emailInput"
              type="email"
              autocomplete="email"
              required
              class={FIELD}
              value={this.emailInput}
            />
            <span error={this.errors.emailInput} class={ERROR} />
          </div>

          <div class="flex justify-end border-t border-border pt-5">
            <button type="submit" loadingAttr="disabled" class={PRIMARY}>
              {__("Save changes")}
            </button>
          </div>
        </form>
      </div>
    );
  }

  private securityPanel(): HtmlNode {
    return (
      <div class={`${CARD} p-5`}>
        <h2 class="text-[0.9375rem] font-semibold">{__("Password")}</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          {__("Choose a strong password for your account.")}
        </p>

        <form onSubmit={this.changePassword} class="mt-5 space-y-5">
          <div class="space-y-1.5">
            <label class={LABEL} for="currentPassword">
              {__("Current password")}
            </label>
            <input
              id="currentPassword"
              type="password"
              autocomplete="current-password"
              required
              class={FIELD}
              value={this.currentPassword}
            />
            <span error={this.errors.currentPassword} class={ERROR} />
          </div>

          <div class="space-y-1.5">
            <label class={LABEL} for="password">
              {__("New password")}
            </label>
            <input
              id="password"
              type="password"
              autocomplete="new-password"
              required
              class={FIELD}
              value={this.password}
            />
            <span error={this.errors.password} class={ERROR} />
            <p class="text-xs text-muted-foreground">{__("At least 8 characters.")}</p>
          </div>

          <div class="space-y-1.5">
            <label class={LABEL} for="password_confirmation">
              {__("Confirm new password")}
            </label>
            <input
              id="password_confirmation"
              type="password"
              autocomplete="new-password"
              required
              class={FIELD}
              value={this.password_confirmation}
            />
          </div>

          <div class="flex justify-end border-t border-border pt-5">
            <button type="submit" loadingAttr="disabled" class={PRIMARY}>
              {__("Update password")}
            </button>
          </div>
        </form>
      </div>
    );
  }

  private appearancePanel(): HtmlNode {
    return (
      <div class={`${CARD} p-5`}>
        <h2 class="text-[0.9375rem] font-semibold">{__("Theme")}</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          {__(
            "Light or dark. The choice is stored in a cookie, so the server can apply it before the page renders.",
          )}
        </p>

        <div class="mt-5 flex gap-2">
          {THEMES.map((theme) => (
            <button
              key={theme}
              onClick={() => this.setTheme(theme)}
              aria-pressed={this.theme === theme ? "true" : "false"}
              class={this.theme === theme ? PRIMARY : SECONDARY}
            >
              {theme === "dark" ? __("Dark") : __("Light")}
            </button>
          ))}
        </div>
      </div>
    );
  }

  private languagePanel(): HtmlNode {
    return (
      <div class={`${CARD} p-5`}>
        <h2 class="text-[0.9375rem] font-semibold">{__("Language")}</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          {__("Applies to the interface and to messages the server sends you.")}
        </p>

        <div class="mt-5 flex flex-wrap gap-2">
          {SUPPORTED_LOCALES.map((code) => (
            <button
              key={code}
              onClick={() => this.setLocale(code)}
              aria-pressed={this.locale === code ? "true" : "false"}
              class={this.locale === code ? PRIMARY : SECONDARY}
            >
              {LOCALE_NAMES[code] ?? code}
            </button>
          ))}
        </div>
      </div>
    );
  }

  /** The section actually being shown — anything unrecognised falls back. */
  private activeSection(): string {
    return SECTIONS.some((s) => s.id === this.section) ? this.section : "profile";
  }

  @expose selectSection(id: string): void {
    if (SECTIONS.some((s) => s.id === id)) this.section = id;
  }

  /**
   * Left/Right/Home/End across the strip — the roving part of the tab pattern.
   *
   * A server action rather than a client expression, because moving the
   * selection is the same operation a click performs and there is no reason for
   * two implementations of it. The focus is pushed back afterwards: an arrow key
   * that changes the selection but leaves focus behind breaks the pattern more
   * visibly than not implementing it at all.
   */
  @expose moveTab(key: string): void {
    const ids = SECTIONS.map((s) => s.id) as readonly string[];
    const at = ids.indexOf(this.activeSection());

    const next =
      key === "ArrowRight" || key === "ArrowDown"
        ? ids[(at + 1) % ids.length]
        : key === "ArrowLeft" || key === "ArrowUp"
          ? ids[(at - 1 + ids.length) % ids.length]
          : key === "Home"
            ? ids[0]
            : key === "End"
              ? ids[ids.length - 1]
              : undefined;

    if (!next) return;
    this.section = next;
    this.client(`document.getElementById('tab-' + ${JSON.stringify(next)})?.focus()`);
  }

  async render(): Promise<HtmlNode> {
    const active = this.activeSection();

    const panel: Record<string, () => HtmlNode> = {
      profile: () => this.detailsPanel(),
      security: () => this.securityPanel(),
      appearance: () => this.appearancePanel(),
      language: () => this.languagePanel(),
    };

    return (
      <div class="max-w-4xl space-y-6">
        <div>
          <h1 class="text-xl font-semibold tracking-tight">{__("Profile")}</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            {__("Manage your personal information, security and preferences.")}
          </p>
        </div>

        <div class="grid gap-6 md:grid-cols-[180px_minmax(0,1fr)] md:gap-8">
          <div
            role="tablist"
            aria-label={__("Settings sections")}
            aria-orientation="vertical"
            onKeydown={(e: KeyboardEvent) => this.moveTab(e.key)}
            class="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0"
          >
            {SECTIONS.map(({ id, label }) => {
              const selected = id === active;
              return (
                <button
                  key={id}
                  id={`tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected ? "true" : "false"}
                  aria-controls={`panel-${id}`}
                  // The roving part: only the selected tab is in the tab order,
                  // so Tab moves past the strip and the arrows move within it.
                  tabindex={selected ? 0 : -1}
                  onClick={() => this.selectSection(id)}
                  class={
                    "flex h-9 shrink-0 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors duration-150 " +
                    (selected
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground")
                  }
                >
                  {__(label)}
                </button>
              );
            })}
          </div>

          <div
            id={`panel-${active}`}
            role="tabpanel"
            aria-labelledby={`tab-${active}`}
            tabindex={0}
          >
            {panel[active]!()}
          </div>
        </div>
      </div>
    );
  }
}
