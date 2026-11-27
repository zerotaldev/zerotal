import { route } from "zerotal";
import { CsrfMiddleware } from "zerotal/session";
import type { HtmlNode } from "@zerotal/flow";
import { socialProviders } from "@app/auth/social";
import { socialLinks } from "../../components/SocialButtons";
import { AuthLayout } from "../../layouts/AuthLayout";
import { buttonClass } from "../../lib/button";
import { Page, titled } from "../../lib/page";
import {
  DIVIDER,
  DIVIDER_LINE,
  FIELD,
  FIELD_ERROR,
  FIELD_HINT,
  FIELD_LABEL_ROW,
  INPUT,
  LABEL,
  icon,
} from "../../lib/ui";

/** GET /register. The form posts to app/routes/(guest)/register.ts. */
export class RegisterPage extends Page {
  static override title = titled("Create an account");

  override layout(page: HtmlNode): HtmlNode {
    return (
      <AuthLayout
        shell={this.shell()}
        title="Create an account"
        description="It takes about ten seconds."
        footer={
          <>
            Already have an account?{" "}
            <a href={route("login")} class="font-medium text-primary hover:underline">
              Sign in
            </a>
          </>
        }
      >
        {page}
      </AuthLayout>
    );
  }

  override async render(): Promise<HtmlNode> {
    // Social providers switched on in config/social.ts.
    const links = socialLinks(socialProviders());
    const name = this.old("name");
    const email = this.old("email");
    const nameError = this.error("name");
    const emailError = this.error("email");
    const passwordError = this.error("password");
    const confirmationError = this.error("password_confirmation");

    return (
      <>
        {links.length > 0 ? (
          <div class="mb-6 space-y-3">
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
            <div class="pt-3">
              <div class={DIVIDER}>
                <span class={DIVIDER_LINE} />
                or with email
                <span class={DIVIDER_LINE} />
              </div>
            </div>
          </div>
        ) : null}

        <form method="post" action={route("register.store")} class="space-y-5">
          {CsrfMiddleware.field()}
          <div class={FIELD}>
            <div class={FIELD_LABEL_ROW}>
              <label for="field-name" class={LABEL}>
                Name
              </label>
            </div>
            <input
              class={INPUT}
              autocomplete="name"
              autofocus
              value={name}
              required
              id="field-name"
              name="name"
              aria-invalid={nameError ? "true" : undefined}
              aria-describedby={nameError ? "field-name-error" : undefined}
            />
            <p id="field-name-error" data-error-for="name" class={FIELD_ERROR} hidden={!nameError}>
              {nameError}
            </p>
          </div>
          <div class={FIELD}>
            <div class={FIELD_LABEL_ROW}>
              <label for="field-email" class={LABEL}>
                Email
              </label>
            </div>
            <input
              class={INPUT}
              type="email"
              autocomplete="email"
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
            </div>
            <input
              class={INPUT}
              type="password"
              autocomplete="new-password"
              required
              id="field-password"
              name="password"
              aria-invalid={passwordError ? "true" : undefined}
              aria-describedby={passwordError ? "field-password-error" : "field-password-hint"}
            />
            <p
              id="field-password-error"
              data-error-for="password"
              class={FIELD_ERROR}
              hidden={!passwordError}
            >
              {passwordError}
            </p>
            <p
              id="field-password-hint"
              data-hint-for="password"
              class={FIELD_HINT}
              hidden={Boolean(passwordError)}
            >
              At least 8 characters.
            </p>
          </div>
          <div class={FIELD}>
            <div class={FIELD_LABEL_ROW}>
              <label for="field-password_confirmation" class={LABEL}>
                Confirm password
              </label>
            </div>
            <input
              class={INPUT}
              type="password"
              autocomplete="new-password"
              required
              id="field-password_confirmation"
              name="password_confirmation"
              aria-invalid={confirmationError ? "true" : undefined}
              aria-describedby={confirmationError ? "field-password_confirmation-error" : undefined}
            />
            <p
              id="field-password_confirmation-error"
              data-error-for="password_confirmation"
              class={FIELD_ERROR}
              hidden={!confirmationError}
            >
              {confirmationError}
            </p>
          </div>
          <button
            type="submit"
            class={buttonClass("primary", "md", "w-full")}
            data-loading-text="Creating account…"
          >
            Create account
          </button>
        </form>
      </>
    );
  }
}
