import { Command, config } from "@zerotal/core";
import { generatePageRegistry } from "../PageRegistry.ts";
import { DEFAULT_PAGES_DIR } from "../config.ts";

/**
 * `make:page` — scaffold a new Inertia page component under the configured pages dir
 * and regenerate the page registry. The framework (React `.tsx` / Vue `.vue`) is
 * auto-detected from the installed adapter unless forced with `--framework`; pass
 * `--layout` to wrap the page in a persistent layout.
 *
 * @category Scaffolding
 * @example
 * ```ts
 * // bun zt make:page Users/Index
 * // bun zt make:page Dashboard --layout MainLayout
 * // bun zt make:page Settings --framework vue
 * ```
 */
export class MakePageCommand extends Command {
  static override commandName = "make:page";
  static override description = "Create a new Inertia page component";
  static override needsApp = false;

  static override args = [
    {
      name: "name",
      required: true,
      description: "Page name, e.g. Dashboard or Users/Index",
    },
  ];

  static override flags = [
    {
      name: "layout",
      type: "string" as const,
      description: "Wrap the page in a persistent layout, e.g. --layout MainLayout",
      default: "",
    },
    {
      name: "framework",
      type: "string" as const,
      description: "Force the frontend framework: 'vue' or 'react' (auto-detected by default)",
      default: "",
    },
  ];

  override async run(): Promise<void> {
    const name = this.args["name"]!; // e.g. 'Users/Index'
    const layout = (this.flags["layout"] as string | undefined) ?? "";
    const pagesDir = config
      .safe("inertia.pagesDir", DEFAULT_PAGES_DIR)
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");

    // Pick the framework: explicit --framework flag, else auto-detect from the
    // installed Inertia adapter (@inertiajs/vue3 → vue, otherwise react).
    const forced = (this.flags["framework"] as string | undefined)?.toLowerCase() ?? "";
    const framework: Framework =
      forced === "vue" || forced === "react"
        ? (forced as Framework)
        : _detectFramework(process.cwd());
    const ext = framework === "vue" ? "vue" : "tsx";

    const path = `${pagesDir}/${name}.${ext}`;

    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }

    const componentName = name.includes("/") ? name.split("/").pop()! : name;

    // Compute how many levels deep the page is so the layout import is correct
    const depth = name.split("/").length;
    const prefix = "../".repeat(depth);
    const stub =
      framework === "vue"
        ? layout
          ? _vueLayoutPageStub(componentName, layout, prefix)
          : _vuePageStub(componentName)
        : layout
          ? _reactLayoutPageStub(componentName, layout, prefix)
          : _reactPageStub(componentName);

    await Bun.write(path, stub);
    this.info(`Created: ${path}`);

    if (layout) {
      this.dim(`  Layout: ${prefix}layouts/${layout}.${ext}`);
      this.dim("  Adjust the import path if your layouts live elsewhere.");
    }

    this.dim("  Regenerating page registry...");
    await generatePageRegistry(process.cwd());
    this.info("Page registry updated.");
  }
}

type Framework = "vue" | "react";

/** Detect the frontend framework from the Inertia adapter installed in `cwd`. */
function _detectFramework(cwd: string): Framework {
  try {
    Bun.resolveSync("@inertiajs/vue3", cwd);
    return "vue";
  } catch {
    return "react";
  }
}

function _reactPageStub(name: string): string {
  return `import { Link, usePage } from '@inertiajs/react';

// Define the props this page receives from the controller
interface Props {
  // TODO: add your props here
}

export default function ${name}({}: Props) {
  const { auth } = usePage<{ auth: { user: { name: string } | null } }>().props;

  return (
    <main>
      <h1>${name}</h1>
      {auth.user && <p>Hello, {auth.user.name}</p>}
      <Link href="/">Home</Link>
    </main>
  );
}
`;
}

function _reactLayoutPageStub(name: string, layout: string, prefix: string): string {
  return `import type { ReactNode } from 'react';
import { Link }          from '@inertiajs/react';
// Adjust the path if your layouts directory is elsewhere
import ${layout}         from '${prefix}layouts/${layout}.tsx';

// Define the props this page receives from the controller
interface Props {
  // TODO: add your props here
}

function ${name}({}: Props) {
  return (
    <main>
      <h1>${name}</h1>
      <Link href="/">Home</Link>
    </main>
  );
}

// Inertia persistent layout — preserved across client-side navigations.
// The layout renders once; only the page content re-renders on navigation.
(${name} as { layout?: (page: ReactNode) => ReactNode }).layout =
  (page) => <${layout}>{page}</${layout}>;

export default ${name};
`;
}

function _vuePageStub(name: string): string {
  return `<script setup lang="ts">
import { Link, usePage } from '@inertiajs/vue3';

const page = usePage<{ auth: { user: { name: string } | null } }>();

// Define the props this page receives from the controller
defineProps<{
  // TODO: add your props here
}>();
</script>

<template>
  <main>
    <h1>${name}</h1>
    <p v-if="page.props.auth.user">Hello, {{ page.props.auth.user.name }}</p>
    <Link href="/">Home</Link>
  </main>
</template>
`;
}

function _vueLayoutPageStub(name: string, layout: string, prefix: string): string {
  return `<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
// Adjust the path if your layouts directory is elsewhere
import ${layout} from '${prefix}layouts/${layout}.vue';

// Inertia persistent layout — preserved across client-side navigations.
// The layout renders once; only the page content re-renders on navigation.
defineOptions({ layout: ${layout} });

// Define the props this page receives from the controller
defineProps<{
  // TODO: add your props here
}>();
</script>

<template>
  <main>
    <h1>${name}</h1>
    <Link href="/">Home</Link>
  </main>
</template>
`;
}
