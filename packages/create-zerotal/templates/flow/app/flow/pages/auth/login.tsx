import { route } from "zerotal";
import { CsrfMiddleware } from "zerotal/session";
import type { HtmlNode } from "@zerotal/flow";
import { passkeysEnabled } from "@app/auth/passkeys";
import { socialProviders } from "@app/auth/social";
import { socialLinks } from "../../components/SocialButtons";
import { AuthLayout } from "../../layouts/AuthLayout";
import { buttonClass } from "../../lib/button";
import { Page, titled } from "../../lib/page";
import {
  CHECKBOX,
  CHECKBOX_LABEL,
  CHECKBOX_ROW,
  DIVIDER,
  DIVIDER_LINE,
  FIELD,
  FIELD_ERROR,
  FIELD_LABEL_ROW,
  INPUT,
  LABEL,
  icon,
} from "../../lib/ui";

/** GET /login. The form posts to app/routes/(guest)/login.ts. */
export class LoginPage extends Page {
  static override title = titled("Sign in");

  override layout(page: HtmlNode): HtmlNode {
    return (
      <AuthLayout
        shell={this.shell()}
        title="Sign in to your account"
        description="Welcome back. Enter your details to continue."
        footer={
          <>
            New here?{" "}
            <a href={route("register")} class="font-medium text-primary hover:underline">
              Create an account
            </a>
          </>
        }
      >
        {page}
      </AuthLayout>
    );
  }

  override async render(): Promise<HtmlNode> {
    // Which other ways in to offer. Both are off until their keys are in .env.
    const passkeys = passkeysEnabled();
    const links = socialLinks(socialProviders());
    const email = this.old("email");
    const emailError = this.error("email");
    const passwordError = this.error("password");

    return (
      <>
        {passkeys || links.length > 0 ? (
          // With no provider to show, the whole block waits on the browser supporting passkeys.
          <div
            class="mb-6 space-y-3"
            data-passkey-only={links.length === 0 ? "" : undefined}
            hidden={links.length === 0}
          >
            {passkeys ? (
              <button
                type="button"
                class={buttonClass("secondary", "md", "w-full")}
                data-passkey-login=""
                data-passkey-only=""
                hidden
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  class="size-4.5"
                  dangerouslySetInnerHTML={icon("fingerprint")}
                />
                <span data-label="">Sign in with a passkey</span>
              </button>
            ) : null}
            {links.length > 0 ? (
              <div class="grid gap-2 sm:grid-cols-2">
                {links.map(({ href, label, icon: name }) => (
                  <a href={href} class={buttonClass("secondary", "md", "w-full")}>
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      class="size-4"
                      dangerouslySetInnerHTML={icon(name)}
                    />
                    {label}
                  </a>
                ))}
              </div>
            ) : null}
            <div class="pt-3">
              <div class={DIVIDER}>
                <span class={DIVIDER_LINE} />
                or with email
                <span class={DIVIDER_LINE} />
              </div>
            </div>
          </div>
        ) : null}

        <form method="post" action={route("login.store")} class="space-y-5">
          {CsrfMiddleware.field()}
          <div class={FIELD}>
            <div class={FIELD_LABEL_ROW}>
              <label for="field-email" class={LABEL}>
                Email
              </label>
            </div>
            <input
              class={INPUT}
              type="email"
              autocomplete={passkeys ? "username webauthn" : "username"}
              autofocus
              value={email}
              required
              id="field-email"
              name="email"
              aria-invalid={emailError ? "true" : undefined}
              aria-describedby={emailError ? "field-email-error" : undefined}
            />
            <p
              id="field-email-error"
              data-error-for="email"
              class={FIELD_ERROR}
              hidden={!emailError}
            >
              {emailError}
            </p>
          </div>
          <div class={FIELD}>
            <div class={FIELD_LABEL_ROW}>
              <label for="field-password" class={LABEL}>
                Password
              </label>
              <a
                href={route("forgot-password")}
                class="text-sm font-medium text-primary hover:underline"
              >
                Forgot password?
              </a>
            </div>
            <input
              class={INPUT}
              type="password"
              autocomplete="current-password"
              required
              id="field-password"
              name="password"
              aria-invalid={passwordError ? "true" : undefined}
              aria-describedby={passwordError ? "field-password-error" : undefined}
            />
            <p
              id="field-password-error"
              data-error-for="password"
              class={FIELD_ERROR}
              hidden={!passwordError}
            >
              {passwordError}
            </p>
          </div>

          <div class={CHECKBOX_ROW}>
            <input
              value="true"
              id="field-remember"
              name="remember"
              type="checkbox"
              class={CHECKBOX}
            />
            <div class="text-sm leading-5">
              <label for="field-remember" class={CHECKBOX_LABEL}>
                Keep me signed in
              </label>
            </div>
          </div>

          <button
            type="submit"
            class={buttonClass("primary", "md", "w-full")}
            data-loading-text="Signing in…"
          >
            Sign in
          </button>
        </form>
      </>
    );
  }
}
