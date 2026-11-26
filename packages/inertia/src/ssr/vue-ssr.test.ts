/**
 * Vue pages, rendered on the server through the real adapter.
 *
 * Everything here runs the packages an app installs — `vue`, `@inertiajs/vue3` and
 * `@vue/compiler-sfc` — against `.vue` files on disk. Until this file, nothing in the
 * repository installed Vue, so the whole Vue branch of server rendering was code
 * nobody had run: it is how `<script setup>` came to drop its scoped-style id and a
 * `<script lang="ts">` page came to fail on its own type annotations.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application, HttpContext, RequestContext, withApp } from "@zerotal/core";
import { inertia, inertiaStream, _setHtmlTemplate, _setPagesDir } from "../inertia.ts";
import { SsrHandler } from "../SsrHandler.ts";
import { detectVuePlugin } from "../vuePlugin.ts";
import { _describeBuildLog } from "@zerotal/core/dev";
import { renderInertiaPage, resolvePageModule } from "./renderPage.ts";

const pagesDir = new URL("../__fixtures__/vue", import.meta.url).pathname.replace(
  /^\/([A-Z]:)/,
  "$1",
);

// The first `.vue` render loads and transpiles the compiler, which on a cold cache
// takes longer than the default five seconds.
const COLD = 30_000;

async function render(component: string, props: Record<string, unknown>) {
  const { modPath, framework } = await resolvePageModule(pagesDir, component);
  expect(framework).toBe("vue");
  return renderInertiaPage({ component, props, url: "/vue" }, modPath, framework);
}

/** An app whose config turns `inertia.ssr` on. */
function ssrApp(): Application {
  const app = Application.create({ env: "test" });
  const read = <T>(k: string, d: T): T => (k === "inertia.ssr" ? (true as unknown as T) : d);
  app.container.value("config" as never, { get: read, safe: read } as never);
  return app;
}

describe("Vue SSR — renderInertiaPage()", () => {
  it(
    "renders a <script setup> page with its props, and reports its <Head> tags",
    async () => {
      const { head, body } = await render("Greeting", { name: "ada", items: ["one", "two"] });

      expect(body).toContain("<h1");
      expect(body).toContain("Hello, ADA");
      expect(body).toContain("<li");
      expect(body).toContain(">one</li>");
      expect(body).toContain(">two</li>");
      expect(head).toEqual(['<title data-inertia="">Greeting page</title>']);
    },
    COLD,
  );

  it("returns the whole SSR root: the page script and a marked #app around the markup", async () => {
    const { body } = await render("Greeting", { name: "ada", items: [] });

    expect(body.startsWith('<script data-page="app" type="application/json">')).toBe(true);
    expect(body).toContain('"props":{"name":"ada","items":[]}');
    expect(body).toContain('data-server-rendered="true"');
    expect(body.match(/id="app"/g)).toHaveLength(1);
  });

  it("puts a <style scoped> page's scope id on its elements", async () => {
    // `<script setup>` exported its component before the scope id was attached to
    // anything, so scoped styles compiled to selectors no element carried.
    const { body } = await render("Greeting", { name: "ada", items: ["one"] });

    const ids = new Set(body.match(/data-v-[0-9a-f]+/g));
    expect(ids.size).toBe(1);
    expect(body).toMatch(/<main class="greeting" data-v-[0-9a-f]+>/);
  });

  it('renders a page written with a plain <script lang="ts">', async () => {
    // Its `export default` was rewritten by a parser that did not read TypeScript, so
    // the first type annotation was a syntax error.
    const { body } = await render("Options", { count: 3 });
    expect(body).toContain("Count 3, doubled 6");
  });
});

describe("Vue SSR — the request path", () => {
  beforeEach(() => {
    _setHtmlTemplate(
      "<!DOCTYPE html><html><head><title>Template</title></head><body><!-- @inertia --></body></html>",
    );
    _setPagesDir(pagesDir);
  });

  afterEach(() => {
    _setHtmlTemplate("");
    _setPagesDir("");
    Application._resetInstance();
  });

  it("serves a Vue page rendered into the document when inertia.ssr is on", async () => {
    await withApp(ssrApp(), async () => {
      const ctx = HttpContext.fake("http://localhost/greeting");
      await RequestContext.run(ctx, () => inertia("Greeting", { name: "grace", items: ["x"] }));

      const html = await ctx.response!.text();
      expect(html).toContain("Hello, GRACE");
      expect(html).toContain('data-server-rendered="true"');
      expect(html.match(/id="app"/g)).toHaveLength(1);
      expect(html.match(/data-page=/g)).toHaveLength(1);
      // The page's <Head> title replaces the template's rather than following it.
      expect(html).toContain('<title data-inertia="">Greeting page</title>');
      expect(html).not.toContain("<title>Template</title>");
    });
  });

  it("streams a Vue page through inertiaStream()", async () => {
    const ctx = HttpContext.fake("http://localhost/greeting-stream");
    await RequestContext.run(ctx, () => inertiaStream("Greeting", { name: "lin", items: [] }));

    expect(ctx.response?.headers.get("Content-Type")).toContain("text/html");
    const html = await ctx.response!.text();
    expect(html).toContain("Hello, LIN");
    expect(html.match(/id="app"/g)).toHaveLength(1);
  });

  it("answers the POST /__ssr contract for a Vue page", async () => {
    const handler = new SsrHandler({ pagesDir });
    const ctx = {
      request: {
        json: () =>
          Promise.resolve({ component: "Options", props: { count: 21 }, url: "/options" }),
      },
      response: undefined as Response | undefined,
      ip: () => "127.0.0.1",
      headers: () => undefined,
    };
    await handler.handle(ctx as never);

    expect(ctx.response?.status).toBe(200);
    const result = (await ctx.response!.json()) as { body: string; head: string[] };
    expect(result.body).toContain("Count 21, doubled 42");
    expect(result.head).toEqual([]);
  });
});

describe("Vue — the browser build", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "zt-inertia-vue-build-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it(
    "compiles .vue pages for the browser through the plugin detectVuePlugin() returns",
    async () => {
      const plugins = await detectVuePlugin(dir);
      expect(plugins).toHaveLength(1);

      const entry = join(dir, "entry.ts");
      writeFileSync(
        entry,
        `import Greeting from ${JSON.stringify(`${pagesDir}/Greeting.vue`)};\n` +
          `import Options from ${JSON.stringify(`${pagesDir}/Options.vue`)};\n` +
          `export const pages = [Greeting, Options];\n`,
      );
      const result = await Bun.build({
        entrypoints: [entry],
        target: "browser",
        plugins,
        throw: false,
      });

      expect(result.logs.map((log) => log.message)).toEqual([]);
      expect(result.success).toBe(true);
      const js = await result.outputs[0]!.text();
      expect(js).toMatch(/data-v-[0-9a-f]+/);
      expect(js).toContain("rebeccapurple");
    },
    COLD,
  );

  // From the 1.18.0 starter walk: a syntax error in a page's `<script setup>` was reported as
  // `index.vue:0:0 … (12:15)`, and a template error named no line at all.
  describe("a .vue error names its line and column", () => {
    async function failure(source: string): Promise<string> {
      const page = join(dir, "index.vue");
      writeFileSync(page, source);
      const entry = join(dir, "entry.ts");
      writeFileSync(entry, `import Page from ${JSON.stringify(page)};\nexport default Page;\n`);
      const result = await Bun.build({
        entrypoints: [entry],
        target: "browser",
        plugins: await detectVuePlugin(dir),
        throw: false,
      });
      expect(result.success).toBe(false);
      return result.logs.map((log) => _describeBuildLog(log)).join("\n");
    }

    it(
      "in <script setup>",
      async () => {
        const out = await failure(
          `<script setup lang="ts">\nconst ok = 1;\nconst broken = ;\n</script>\n<template><p>{{ ok }}</p></template>\n`,
        );
        expect(out).toContain(`${join(dir, "index.vue")}:3:15 `);
        expect(out).not.toContain(":0:0");
        expect(out.split("\n")[0]).not.toContain("(3:15)");
      },
      COLD,
    );

    it(
      "in a template, counted from the top of the file",
      async () => {
        const out = await failure(
          `<script>\nexport default { data: () => ({ a: 1 }) };\n</script>\n\n<template>\n  <div>\n    <p>{{ a + }}</p>\n  </div>\n</template>\n`,
        );
        expect(out).toMatch(
          new RegExp(`${join(dir, "index.vue").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:7:\\d+ `),
        );
        expect(out).not.toContain(":0:0");
      },
      COLD,
    );

    it(
      "in the markup the parser reads",
      async () => {
        const out = await failure(`<template>\n  <div>\n    <span>\n  </div>\n</template>\n`);
        expect(out).toMatch(/index\.vue:[1-9]\d*:\d+ \[vue\] Failed to parse: /);
      },
      COLD,
    );
  });
});
