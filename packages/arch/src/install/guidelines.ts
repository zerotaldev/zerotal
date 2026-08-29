/**
 * The instructions written into `AGENTS.md`.
 *
 * Composed from what the project actually has: an app without `@zerotal/admin`
 * never reads a line about admin resources. Every prompt this file lands in pays
 * for its whole length, so each block earns its place or is not emitted.
 *
 * The content deliberately points rather than teaches. There is a `search_docs`
 * tool and an `api_surface` tool three lines above; a paraphrase of the routing
 * guide here would be a second copy to drift, and a worse one — the pages it
 * would summarise are the ones those tools return in full.
 */

import type { ProjectShape } from "./shape.ts";

/** A block contributed by one installed package. */
interface PackageBlock {
  /** The package that triggers it. */
  pkg: string;
  lines: string[];
}

/**
 * Per-package guidance, at the level of "this exists, here is what owns it".
 *
 * Kept to a few lines each on purpose: the point is to stop an agent inventing
 * an API when the framework already has one, not to replace the documentation
 * it can now search.
 */
const PACKAGE_BLOCKS: PackageBlock[] = [
  {
    pkg: "@zerotal/orm",
    lines: [
      "**Data.** Models are Active Record classes in `app/models/`, declared with `@table` and " +
        "`@column` decorators; `DB` from `@zerotal/orm` is the query builder. Migrations live in " +
        "`database/migrations/` — generate with `bun zt make:migration`, never hand-edit an " +
        "applied one. Call `schema` before writing a query or a factory.",
    ],
  },
  {
    pkg: "@zerotal/auth",
    lines: [
      "**Auth.** `Auth` from `@zerotal/auth` for the current user; policies go in `app/policies/` " +
        "and are discovered automatically. Do not hand-roll password hashing or session handling.",
    ],
  },
  {
    pkg: "@zerotal/validator",
    lines: [
      "**Validation.** `FormRequest` subclasses in `app/requests/`, or `validate()` inline. " +
        "Rules are built with `RuleBuilder`, so a typo is a compile error rather than a runtime one.",
    ],
  },
  {
    pkg: "@zerotal/flow",
    lines: [
      "**Flow components.** Server-rendered interactive components: a class with state fields and " +
        "actions, rendered as JSX. Every component is an island and is fully interactive — there " +
        "is no separate hydration step to write. `bun zt make:flow` scaffolds one.",
    ],
  },
  {
    pkg: "@zerotal/flow-ui",
    lines: [
      "**UI kit.** `@zerotal/flow-ui` ships the component set. Check it before writing a button, " +
        "modal, table or form field from scratch.",
    ],
  },
  {
    pkg: "@zerotal/inertia",
    lines: [
      "**Inertia.** Pages are React/Vue components under `resources/`; controllers return " +
        "`Inertia.render(...)`. Props are serialised — do not pass class instances.",
    ],
  },
  {
    pkg: "@zerotal/admin",
    lines: [
      "**Admin.** Resources in `app/admin/` describe tables, forms and infolists declaratively. " +
        "`bun zt make:admin-resource` scaffolds one; prefer extending a resource over writing a " +
        "bespoke page.",
    ],
  },
  {
    pkg: "@zerotal/queue",
    lines: [
      "**Background work.** Jobs in `app/jobs/`, dispatched with `.dispatch()`. Anything slower " +
        "than a request belongs in one. `bun zt queue:work` runs the worker; `bun zt dev` runs it " +
        "for you.",
    ],
  },
  {
    pkg: "@zerotal/cache",
    lines: ["**Cache.** `Cache` from `@zerotal/cache`. Never cache a request-scoped value."],
  },
  {
    pkg: "@zerotal/scheduler",
    lines: [
      "**Scheduling.** Schedules in `app/schedules/`, discovered at boot. They need " +
        "`SchedulerProvider` registered — `doctor` will say so if it is missing.",
    ],
  },
  {
    pkg: "@zerotal/notifications",
    lines: [
      "**Notifications.** Notification classes in `app/notifications/`, one `via()` per channel.",
    ],
  },
  {
    pkg: "@zerotal/media",
    lines: ["**Media.** `@zerotal/media` owns uploads, conversions and the media library."],
  },
  {
    pkg: "@zerotal/broadcasting",
    lines: [
      "**Realtime.** Channels are declared in the app and authorised server-side. " +
        "`bun zt make:channel` scaffolds one.",
    ],
  },
  {
    pkg: "@zerotal/i18n",
    lines: [
      "**Translations.** `@zerotal/i18n`; message files live under `resources/lang/`. " +
        'Translate with `__("English sentence")` — the source string is the key, so there ' +
        "is no catalog for the source language and no key to invent.",
    ],
  },
  {
    pkg: "@zerotal/tenancy",
    lines: [
      "**Multi-tenancy.** Tenant resolution is middleware-driven. Anything tenant-scoped must go " +
        "through it rather than reading an id from the request.",
    ],
  },
  {
    pkg: "@zerotal/testing",
    lines: [
      "**Tests.** `createTestApp()` from `@zerotal/testing` boots a real app; factories and fakes " +
        "come from the same package. Tests run on `bun test` via `bun zt test`.",
    ],
  },
];

export interface GuidelineOptions {
  /** Installed `@zerotal/*` package names, as reported by `app_info`. */
  packages: string[];
  /** The key the MCP server is registered under, so the text names it correctly. */
  serverName: string;
  /**
   * How this project is configured, from {@link detectShape}. Omitted, the block
   * is what it always was — a function of the package list.
   */
  shape?: ProjectShape | undefined;
}

/**
 * The preamble written above the managed block when the file is created.
 *
 * Once written it is never touched again — it exists to tell whoever opens the
 * file that the fenced part is generated and the rest is theirs.
 */
export function agentsPreamble(): string {
  return [
    "# Agent instructions",
    "",
    "Guidance for coding agents working in this repository.",
    "",
    "Everything between the `zerotal:arch` markers below is generated by",
    "`bun zt arch:update` and will be replaced on the next framework upgrade.",
    "Write your own project-specific instructions outside that block — they are",
    "preserved.",
  ].join("\n");
}

/** Build the managed block for `AGENTS.md`. */
export function buildGuidelines(options: GuidelineOptions): string {
  const installed = new Set(options.packages);
  const sections: string[] = [
    "## Zerotal",
    "",
    "This is a Zerotal app: a Bun-native, full-stack TypeScript framework. Bun executes",
    "`.ts` directly — there is no build step, and what you write is what runs.",
    "",
    toolSection(options.serverName),
    "",
    conventionSection(),
    "",
    commandSection(),
  ];

  const blocks = PACKAGE_BLOCKS.filter((block) => installed.has(block.pkg));
  if (blocks.length > 0) {
    sections.push(
      "",
      "### What this app has",
      "",
      ...blocks.flatMap((block) => [...block.lines, ""]),
    );
  }

  const shape = options.shape ? shapeSection(options.shape) : "";
  if (shape) sections.push("", shape);

  sections.push(rulesSection());

  return sections
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toolSection(serverName: string): string {
  return [
    `### Use the \`${serverName}\` MCP tools`,
    "",
    "This project exposes the framework's machine-readable truth as MCP tools. Prefer them",
    "over recalling an API from memory — they describe the versions installed here.",
    "",
    "- `app_info` — versions, providers and package maturity. Worth one call at the start.",
    "- `api_surface` — the exact signature of every export in a package.",
    "- `search_docs` — the framework documentation for this installed version.",
    "- `routes` — the routes actually registered, with their names.",
    "- `schema` — what the models declare: tables, columns, indexes.",
    "- `logs` / `last_error` — what the app actually did.",
    "- `baselines` — the quality ratchets and the commands that check them.",
    "- `doctor` — run it before calling any task done.",
  ].join("\n");
}

function conventionSection(): string {
  return [
    "### Conventions",
    "",
    "Classes are discovered by directory. Put a file in the right place and it registers",
    "itself; no manifest to update.",
    "",
    "```text",
    "app/controllers/   app/models/      app/middleware/   app/policies/",
    "app/jobs/          app/events/      app/listeners/    app/observers/",
    "app/commands/      app/schedules/   app/requests/     app/notifications/",
    "routes/            config/          database/migrations/   tests/",
    "```",
    "",
    "Imports follow one rule: the kernel comes from `zerotal` (and `zerotal/routes`,",
    "`zerotal/http`, …), everything else from its own package.",
    "",
    "```ts",
    'import type { HttpContext } from "zerotal";',
    'import { route } from "zerotal/routes";',
    'import { DB } from "@zerotal/orm";',
    "```",
  ].join("\n");
}

function commandSection(): string {
  return [
    "### Commands",
    "",
    "```bash",
    "bun zt dev             # server plus every companion process, in one deck",
    "bun zt list            # every command this app has, including package ones",
    "bun zt make:<thing>    # scaffold — prefer it over writing boilerplate by hand",
    "bun zt route:list      # registered routes",
    "bun zt route:types     # regenerate typed route names after changing routes",
    "bun zt test            # tests, with the app booted",
    "bun zt doctor          # health checks, with a fix beside each finding",
    "```",
  ].join("\n");
}

/**
 * What this project is configured to be, where that changes what to write.
 *
 * The rest of this file describes the framework; this describes *this app*. The
 * distinction matters because the framework's contracts are not uniform, and the
 * places they differ are places where guessing wrong compiles cleanly and fails
 * at runtime. An `EmailVerification` mixin needs a migration in one app and not
 * in another, and the app that needed one lost 419 tests to a column that was
 * never created.
 *
 * Only facts that change an instruction are emitted. "This app uses SQLite" is
 * trivia; "migrations own the schema here, so a new column needs one" is a
 * decision the agent would otherwise get wrong half the time.
 */
function shapeSection(shape: ProjectShape): string {
  const lines: string[] = [];

  if (shape.schemaSource === "migrations") {
    lines.push(
      "- **Migrations own the schema.** A new or changed column needs a migration — including " +
        "columns a mixin registers imperatively, which are added to tables that already exist " +
        "but never create one. Generate with `bun zt make:migration`, guard an added column " +
        "with `Schema.hasColumn`, and never hand-edit a migration that has run.",
    );
  } else if (shape.schemaSource === "models") {
    lines.push(
      "- **The models own the schema** (`database.synchronize`). The table is built from what " +
        "the models declare, so a `@column` is the whole change and there is no migration to " +
        "write. Check `schema` after adding one to confirm it landed.",
    );
  } else if (shape.schemaSource === "both") {
    lines.push(
      "- **Both `database.synchronize` and migrations are present**, which is deliberate in " +
        "some apps (sync locally, migrations in production) and a mistake in others. Run " +
        "`doctor` and read what it says about the source of truth before adding a column — " +
        "the answer decides whether a migration is required or would collide.",
    );
  }

  if (shape.routeTypes) {
    lines.push(
      "- **Route names are typed.** `types/routes.generated.ts` exists, so `route()` is checked " +
        "against it and a stale file turns a working call into a type error. Run " +
        "`bun zt route:types` after any route change.",
    );
  }

  if (shape.strict.exactOptionalPropertyTypes) {
    lines.push(
      "- **`exactOptionalPropertyTypes` is on.** `{ x: undefined }` is not assignable to " +
        "`{ x?: T }`. Build optional properties conditionally — `...(v ? { x: v } : {})` — " +
        "rather than assigning `undefined` and expecting the key to be treated as absent.",
    );
  }

  if (shape.strict.noUncheckedIndexedAccess) {
    lines.push(
      "- **`noUncheckedIndexedAccess` is on.** Every index read is `T | undefined`. Narrow it; " +
        "do not reach for `!` to silence it.",
    );
  }

  if (shape.hasTests) {
    lines.push(
      "- **This app has tests.** Run `bun zt test` before calling a task done — `doctor` checks " +
        "configuration, not behaviour, and only one of the two notices that a change broke " +
        "something.",
    );
  }

  if (lines.length === 0) return "";
  return ["### How this app is set up", "", ...lines].join("\n");
}

function rulesSection(): string {
  return [
    "",
    "### Rules",
    "",
    "1. **The types are the guidance.** If a call type-checks it is almost certainly the",
    "   intended one. Read the signature with `api_surface` rather than guessing and",
    "   correcting.",
    "2. **Scaffold before you write.** `bun zt make:*` produces the shape the framework",
    "   expects, including the parts that are easy to forget.",
    "3. **Regenerate route types** with `bun zt route:types` whenever routes change —",
    "   `route()` is checked against the generated names.",
    "4. **Finish with `doctor`.** A task with a failing check is not done. Warnings are",
    "   worth reading; failures are work.",
    "5. **Do not add dependencies** without being asked. The framework covers most of",
    "   what an app needs, and `search_docs` will say where.",
  ].join("\n");
}

/**
 * The `CLAUDE.md` shim.
 *
 * An import line rather than a copy: Claude Code does not read `AGENTS.md`
 * natively, and two files of guidance that start identical do not stay that way.
 */
export function claudeShim(): string {
  return [
    "@AGENTS.md",
    "",
    "The instructions for this project live in `AGENTS.md` — the cross-tool standard, read",
    "natively by most other agents. The line above imports it. Add anything Claude-specific",
    "below, outside the generated block.",
  ].join("\n");
}
