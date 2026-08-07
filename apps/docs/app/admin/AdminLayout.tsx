import { Layout, Link, Flash } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { asset } from "zerotal/assets";
import { Auth } from "zerotal/auth";
import { RICH_EDITOR_SCRIPT } from "./rich-editor.ts";

/**
 * Chrome for the authoring pages. Deliberately plainer than the public docs
 * layout — this is a workbench, and it shares only the brand colours.
 */
export class AdminLayout extends Layout {
  // A getter, not a static field, so asset() re-runs per request and picks up the
  // latest ?v= token after a dev rebuild.
  static override get head(): string {
    return `
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <link rel="icon" href="/favicon.svg">
  <link rel="stylesheet" href="${asset("/css/app.css")}">
  `;
  }

  override render(slot: HtmlNode) {
    const navLink =
      "rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 no-underline transition " +
      "hover:bg-stone-100 hover:text-ink data-[current]:bg-voltage-50 data-[current]:text-voltage-700";

    // The login page wears this layout too, so the desk's own navigation — and the
    // sign-out button — only appear once there is a session to act on.
    const author = Auth.userOrNull();

    return (
      <div class="min-h-screen bg-stone-50 text-ink antialiased">
        <header class="border-b border-stone-200 bg-white">
          <nav class="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
            <div class="flex items-center gap-4">
              <Link href="/admin" current={false} class="flex items-center gap-2 no-underline">
                <img src="/brand/mark.svg" alt="" class="h-6 w-6" />
                <span class="font-display text-sm font-bold tracking-[-0.02em]">Writing desk</span>
              </Link>
              {author ? (
                <>
                  <Link href="/admin" class={navLink}>
                    Posts
                  </Link>
                  <Link href="/admin/posts/new" class={navLink}>
                    New post
                  </Link>
                </>
              ) : (
                ""
              )}
            </div>
            <div class="flex items-center gap-3">
              <a href="/blog" class="text-sm text-stone-500 no-underline hover:text-ink">
                View blog ↗
              </a>
              {author ? (
                <form method="post" action="/admin/logout" class="flex items-center gap-3">
                  <span class="text-sm text-stone-500">{author.name}</span>
                  <button
                    type="submit"
                    class="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-500 transition hover:bg-stone-100 hover:text-ink"
                  >
                    Sign out
                  </button>
                </form>
              ) : (
                ""
              )}
            </div>
          </nav>
        </header>

        <main class="mx-auto max-w-5xl px-6 py-10">{slot}</main>
        <Flash position="bottom-right" />

        {/* Installed here, not beside the editor: a <script> inserted by Flow's
            DOM morph never executes, so an editor opened by an action would get
            no behaviour. Everything inside is delegated from `document`. */}
        <script dangerouslySetInnerHTML={{ __html: RICH_EDITOR_SCRIPT }} />
      </div>
    );
  }
}
