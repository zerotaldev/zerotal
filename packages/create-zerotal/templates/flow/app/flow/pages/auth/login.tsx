import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { passkeysEnabled } from "@app/auth/passkeys";
import { socialProviders } from "@app/auth/social";
import { Button } from "../../components/Button";
import { Checkbox } from "../../components/Checkbox";
import { TextField } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Divider, SocialButtons } from "../../components/SocialButtons";
import { AuthLayout } from "../../layouts/AuthLayout";
import { Page, titled } from "../../lib/page";

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
    const providers = socialProviders();

    return (
      <>
        {passkeys || providers.length > 0 ? (
          // With no provider to show, the whole block waits on the browser supporting passkeys.
          <div
            class="mb-6 space-y-3"
            data-passkey-only={providers.length === 0 ? "" : undefined}
            hidden={providers.length === 0}
          >
            {passkeys ? (
              <Button
                variant="secondary"
                class="w-full"
                data-passkey-login=""
                data-passkey-only=""
                hidden
              >
                <Icon name="fingerprint" class="size-4.5" />
                <span data-label="">Sign in with a passkey</span>
              </Button>
            ) : null}
            <SocialButtons providers={providers} />
            <div class="pt-3">
              <Divider label="or with email" />
            </div>
          </div>
        ) : null}

        <form method="post" action={route("login.store")} class="space-y-5">
          <TextField
            label="Email"
            name="email"
            type="email"
            // `webauthn` lets the browser offer a saved passkey right in the field.
            autocomplete={passkeys ? "username webauthn" : "username"}
            autofocus
            value={this.old("email")}
            error={this.error("email")}
            required
          />

          <TextField
            label="Password"
            name="password"
            type="password"
            autocomplete="current-password"
            error={this.error("password")}
            aside={
              <a
                href={route("forgot-password")}
                class="text-sm font-medium text-primary hover:underline"
              >
                Forgot password?
              </a>
            }
            required
          />

          <Checkbox label="Keep me signed in" name="remember" value="true" />

          <Button type="submit" class="w-full" data-loading-text="Signing in…">
            Sign in
          </Button>
        </form>
      </>
    );
  }
}
