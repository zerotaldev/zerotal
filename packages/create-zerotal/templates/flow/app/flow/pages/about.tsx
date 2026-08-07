import { Component } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { AppLayout } from "../layouts/app";

export class AboutPage extends Component {
  static layout = AppLayout;
  static title = "About";

  async render(): Promise<HtmlNode> {
    return (
      <section class="py-4">
        <h1 class="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">About</h1>
        <div class="mt-6 space-y-4 text-lg leading-relaxed text-gray-600">
          <p>
            This is an example app built with{" "}
            <span class="font-medium text-gray-900">Zerotal</span> and its server-driven view
            layer, <span class="font-medium text-gray-900">Flow</span>.
          </p>
          <p>
            Each file under{" "}
            <code class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm text-indigo-600">
              app/flow/pages
            </code>{" "}
            becomes a route — this page lives in{" "}
            <code class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm text-indigo-600">
              about.tsx
            </code>{" "}
            and is served at <span class="font-medium text-gray-900">/about</span>. Navigation
            between pages happens over a WebSocket, so it feels instant — no full reloads.
          </p>
        </div>
      </section>
    );
  }
}
