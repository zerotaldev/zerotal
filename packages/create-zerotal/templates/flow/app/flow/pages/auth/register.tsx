import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { socialProviders } from "@app/auth/social";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { Divider, SocialButtons } from "../../components/SocialButtons";
import { AuthLayout } from "../../layouts/AuthLayout";
import { Page, titled } from "../../lib/page";

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
    const providers = socialProviders();

    return (
      <>
        {providers.length > 0 ? (
          <div class="mb-6 space-y-3">
            <SocialButtons providers={providers} />
            <div class="pt-3">
              <Divider label="or with email" />
            </div>
          </div>
        ) : null}

        <form method="post" action={route("register.store")} class="space-y-5">
          <TextField
            label="Name"
            name="name"
            autocomplete="name"
            autofocus
            value={this.old("name")}
            error={this.error("name")}
            required
          />

          <TextField
            label="Email"
            name="email"
            type="email"
            autocomplete="email"
            value={this.old("email")}
            error={this.error("email")}
            required
          />

          <TextField
            label="Password"
            name="password"
            type="password"
            autocomplete="new-password"
            hint="At least 8 characters."
            error={this.error("password")}
            required
          />

          <TextField
            label="Confirm password"
            name="password_confirmation"
            type="password"
            autocomplete="new-password"
            error={this.error("password_confirmation")}
            required
          />

          <Button type="submit" class="w-full" data-loading-text="Creating account…">
            Create account
          </Button>
        </form>
      </>
    );
  }
}
