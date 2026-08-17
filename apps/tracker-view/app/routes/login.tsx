import type { HttpContext } from "zerotal";
import { view } from "zerotal";
import { Auth, GuestMiddleware } from "zerotal/auth";
import { validate } from "zerotal/validator";
import { AuthLayout } from "../../resources/views/layouts/AuthLayout.tsx";
import { Field, buttonClass } from "../../resources/views/components/Ui.tsx";

export const middleware = [GuestMiddleware];

/**
 * GET/POST /login — feature 1, without a line of client JavaScript.
 *
 * The form is an ordinary `<form method="post">`. That is the whole mechanism:
 * the browser serialises it, the server validates, and a failure redirects back
 * with the errors and the submitted input flashed. The Inertia build reaches the
 * same outcome through a fetch and a prop update, which is the divergence the
 * recipe is about — same URL, same rules, same messages, different transport.
 */
export const GET = async (http: HttpContext) => {
  const errors = http.session?.get<Record<string, string>>("errors") ?? {};
  const old = http.session?.get<Record<string, string>>("old") ?? {};

  view(
    <AuthLayout
      title={__("Welcome back")}
      subtitle={__("Sign in to your Tracker account.")}
      flash={{ error: http.session?.get<string>("error") ?? null }}
      footer={{
        text: __("Don’t have an account?"),
        link: __("Create one"),
        href: "/register",
      }}
    >
      <form method="post" action={route("login.store")} class="space-y-5">
        <Field
          label={__("Email")}
          name="email"
          type="email"
          autocomplete="email"
          value={old["email"] ?? ""}
          error={errors["email"]}
          required
        />
        <Field
          label={__("Password")}
          name="password"
          type="password"
          autocomplete="current-password"
          error={errors["password"]}
          required
        />

        <label class="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" name="remember" value="1" class="rounded border-input" />
          {__("Remember me")}
        </label>

        <button type="submit" class={`${buttonClass("primary")} w-full`}>
          {__("Sign in")}
        </button>

        <p class="text-center text-sm">
          <a href="/forgot-password" class="text-muted-foreground hover:text-foreground">
            {__("Forgot your password?")}
          </a>
        </p>
      </form>
    </AuthLayout>,
  );
};

export async function POST(http: HttpContext): Promise<void> {
  const { email, password, remember } = await validate(http, (r) => ({
    email: r.string().trim().email(),
    password: r.string().min(1),
    remember: r.boolean().optional(),
  }));

  if (!(await Auth.attempt({ email, password }, Boolean(remember)))) {
    // One message for a wrong address and a wrong password alike. Saying which
    // was wrong would turn this form into a way to discover valid accounts.
    http.flash("error", __("Those credentials do not match our records."));
    http.redirect(route("login"), 303);
    return;
  }

  http.flash("success", __("Welcome back."));
  http.redirect(route("projects"), 303);
}
