import { Component } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { AppLayout } from "../layouts/app";

export class ContactPage extends Component {
  static layout = AppLayout;
  static title = "Contact";

  async render(): Promise<HtmlNode> {
    return (
      <section class="py-4">
        <h1 class="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">Contact</h1>
        <p class="mt-4 text-lg leading-relaxed text-gray-600">
          Have a question or feedback? We'd love to hear from you.
        </p>

        <div class="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <dl class="space-y-4 text-sm">
            <div class="flex items-center justify-between gap-4">
              <dt class="font-medium text-gray-500">Email</dt>
              <dd>
                <a href="mailto:hello@example.com" class="font-medium text-indigo-600 hover:text-indigo-700">
                  hello@example.com
                </a>
              </dd>
            </div>
            <div class="flex items-center justify-between gap-4">
              <dt class="font-medium text-gray-500">GitHub</dt>
              <dd>
                <a href="https://github.com" class="font-medium text-indigo-600 hover:text-indigo-700">
                  github.com/your-org
                </a>
              </dd>
            </div>
          </dl>

          <a
            href="mailto:hello@example.com"
            class="mt-6 inline-block w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            Email us
          </a>
        </div>
      </section>
    );
  }
}
