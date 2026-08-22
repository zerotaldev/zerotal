/** @jsxImportSource @zerotal/flow */
import { Component, expose, validate } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { ShowcaseLayout } from "../ShowcaseLayout.tsx";
import { Demo } from "../Demo.tsx";

const CODE = `@expose @validate((r) => r.required().min(2).max(50)) name = "";
@expose @validate((r) => r.required().email()) email = "";
@expose @validate((r) => r.required().min(8)) password = "";

@expose async submit() {
  await this.validate();   // runs all @validate rules on the server
  this.flash("Account created.", "success");
}

// \`live\` validates the field on the server on every keystroke
<input value={this.email} live type="email" />
<span error={this.errors.email} />   // appears / clears reactively
<button type="submit" loadingAttr="disabled">Create account</button>`;

/**
 * Forms & real-time validation. Each `@validate` field is bound with `live`, so the server
 * validates it on every keystroke and the error appears/clears as you type — no action call,
 * no client validation library. `submit` runs the full `this.validate()` and, on success,
 * flashes a toast (rendered by `<Flash>` in the showcase layout).
 */
export class FormsPage extends Component {
  static title = "Forms & validation — Flow showcase";

  @expose @validate((rule) => rule.required().min(2).max(50)) name = "";
  @expose @validate((rule) => rule.required().email()) email = "";
  @expose @validate((rule) => rule.required().min(8)) password = "";

  @expose async submit(): Promise<void> {
    await this.validate();
    this.flash(`Welcome, ${this.name.trim()} — the form validated on the server.`, "success");
    this.name = "";
    this.email = "";
    this.password = "";
    this.resetValidation();
  }

  override layout(page: HtmlNode): HtmlNode {
    return <ShowcaseLayout>{page}</ShowcaseLayout>;
  }

  override async render(): Promise<HtmlNode> {
    const input =
      "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-orange-400 focus:outline-none";
    const err = "mt-1 block text-xs text-red-500";
    const label = "block text-sm font-medium text-slate-700";

    return (
      <div class="space-y-6">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-slate-900">Forms &amp; validation</h1>
          <p class="mt-1 max-w-2xl text-sm text-slate-500">
            Every field validates on the <strong>server</strong> as you type — the rule chain lives
            on the component (<code class="font-mono text-orange-600">@validate</code>). Type an
            invalid email or a short password and the message appears; fix it and it clears. Submit
            runs the whole form.
          </p>
        </div>

        <Demo code={CODE}>
          <form onSubmit={this.submit} class="max-w-md space-y-4">
            <div>
              <label for="name" class={label}>
                Name
              </label>
              <input
                id="name"
                name="name"
                value={this.name}
                live
                placeholder="Ada Lovelace"
                class={input}
              />
              <span error={this.errors.name} class={err} />
            </div>

            <div>
              <label for="email" class={label}>
                Email
              </label>
              <input
                id="email"
                name="email"
                value={this.email}
                live
                type="email"
                placeholder="ada@example.com"
                class={input}
              />
              <span error={this.errors.email} class={err} />
            </div>

            <div>
              <label for="password" class={label}>
                Password
              </label>
              <input
                id="password"
                name="password"
                value={this.password}
                live
                type="password"
                placeholder="At least 8 characters"
                class={input}
              />
              <span error={this.errors.password} class={err} />
            </div>

            <button
              type="submit"
              loadingAttr="disabled"
              class="w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600 disabled:opacity-60"
            >
              Create account
            </button>
          </form>
        </Demo>
      </div>
    );
  }
}
