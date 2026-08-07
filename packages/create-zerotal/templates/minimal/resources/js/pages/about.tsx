import type { HttpContext } from "zerotal";
import AppLayout from "../layouts/AppLayout";

export default function About(ctx: HttpContext, { title }: { title: string }) {
  return (
    <AppLayout title={title} path={ctx.url.pathname}>
      <section class="py-4">
        <h1 class="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">About</h1>
        <div class="mt-6 space-y-4 text-lg leading-relaxed text-gray-600">
          <p>
            This is an example app built with{" "}
            <span class="font-medium text-gray-900">Zerotal</span> and its server-rendered JSX view
            layer.
          </p>
          <p>
            Routes are declared in{" "}
            <code class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm text-indigo-600">
              routes/index.ts
            </code>{" "}
            and render pages from{" "}
            <code class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm text-indigo-600">
              resources/js/pages
            </code>
            . This page is served at <span class="font-medium text-gray-900">/about</span>.
          </p>
        </div>
      </section>
    </AppLayout>
  );
}
