import { Component, expose, Link } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Auth, GuestMiddleware, Hash } from "zerotal/auth";
import { User } from "@app/models/User";
import { AppLayout } from "../layouts/app";
import { FIELD, LABEL, PRIMARY, CARD, ERROR } from "../ui";

export const middleware = [GuestMiddleware];

export class RegisterPage extends Component {
  static layout = AppLayout;
  static title = "Create an account";

  @expose name = "";
  @expose email = "";
  @expose password = "";
  @expose passwordConfirmation = "";
  @expose error = "";

  @expose async register(): Promise<void> {
    this.error = "";

    if (this.name.trim() === "" || this.email.trim() === "") {
      this.error = "Name and email are required.";
      return;
    }
    if (this.password.length < 8) {
      this.error = "Choose a password of at least 8 characters.";
      return;
    }
    if (this.password !== this.passwordConfirmation) {
      this.error = "The two passwords do not match.";
      return;
    }

    const taken = await User.query().where("email", this.email).first();
    if (taken) {
      this.error = "That email is already registered.";
      return;
    }

    // `role` is not fillable, so it cannot arrive from the form at all — it is
    // set here, in code, which is the whole point of leaving it off `fillable`.
    const user = new User();
    user.name = this.name;
    user.email = this.email;
    user.password = await Hash.make(this.password);
    user.role = "user";
    await user.save();

    // Check the result. Redirecting to a guarded page on a failed attempt sends
    // the visitor to /profile, where AuthMiddleware turns them straight back to
    // /login — so the account is created and they are bounced to a sign-in form
    // with no error shown anywhere. Report it instead of redirecting into it.
    if (!(await Auth.attempt({ email: this.email, password: this.password }))) {
      this.error = "Your account was created, but signing you in failed. Please sign in.";
      return;
    }

    this.redirect("/profile").withSuccess("Welcome aboard.");
  }

  async render(): Promise<HtmlNode> {
    return (
      <section class={CARD}>
        <h1 class="text-2xl font-bold tracking-tight">Create an account</h1>
        <p class="mt-1 text-sm text-gray-600">It takes about ten seconds.</p>

        <form onSubmit={this.register} class="mt-6 space-y-4">
          {this.error ? <p class={ERROR}>{this.error}</p> : null}

          <div>
            <label class={LABEL} for="name">
              Name
            </label>
            <input id="name" type="text" autocomplete="name" required class={FIELD} value={this.name} />
          </div>

          <div>
            <label class={LABEL} for="email">
              Email
            </label>
            <input id="email" type="email" autocomplete="email" required class={FIELD} value={this.email} />
          </div>

          <div>
            <label class={LABEL} for="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autocomplete="new-password"
              required
              class={FIELD}
              value={this.password}
            />
          </div>

          <div>
            <label class={LABEL} for="password_confirmation">
              Confirm password
            </label>
            <input
              id="password_confirmation"
              type="password"
              autocomplete="new-password"
              required
              class={FIELD}
              value={this.passwordConfirmation}
            />
          </div>

          <button type="submit" class={PRIMARY}>
            Create account
          </button>
        </form>

        <p class="mt-6 text-sm text-gray-600">
          Already registered?{" "}
          <Link href="/login" class="text-indigo-600 hover:underline">
            Sign in
          </Link>
        </p>
      </section>
    );
  }
}
