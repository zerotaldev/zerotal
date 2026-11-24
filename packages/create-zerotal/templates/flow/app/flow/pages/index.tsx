import { Component, Link } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { AppLayout } from "../layouts/app";

export class WelcomePage extends Component {
  static layout = AppLayout;
  static title = "Home";

  async render(): Promise<HtmlNode> {
    return (
      <section class="py-10 text-center">
        <span class="inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700 ring-1 ring-green-600/20">
          <span class="h-2 w-2 rounded-full bg-green-500"></span>
          The install worked successfully!
        </span>

        <h1 class="mx-auto mt-6 max-w-2xl text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
          Build server-driven apps with <span class="text-indigo-600">Zerotal</span>
        </h1>

        <p class="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-gray-600">
          Flow pages, file-based routing, and Tailwind — out of the box. Edit{" "}
          <code class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm text-indigo-600">
            app/flow/pages/index.tsx
          </code>{" "}
          to get started.
        </p>

        <div class="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/about"
            hover
            class="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            Learn more
          </Link>
          <Link
            href="/contact"
            hover
            class="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
          >
            Get in touch
          </Link>
        </div>
      </section>
    );
  }
}
