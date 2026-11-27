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

/**
 * The packages the `zerotal` bundle re-exports, as `zerotal/<name>`.
 *
 * An app that declares the bundle imports these through it, and every line of
 * guidance that names one has to say so: a starter's `AGENTS.md` that said
 * "`DB` from `@zerotal/orm`" two paragraphs after "an `@zerotal/orm` import would
 * reach a package this app does not declare" told an agent both things. A test
 * holds this list to the bundle's own dependencies.
 *
 * @internal
 */
export const _BUNDLED_PACKAGES: readonly string[] = [
  "@zerotal/auth",
  "@zerotal/cache",
  "@zerotal/media",
  "@zerotal/orm",
  "@zerotal/queue",
  "@zerotal/scheduler",
  "@zerotal/session",
  "@zerotal/testing",
  "@zerotal/validator",
];

/** What a package block is written against. */
interface BlockContext {
  /** The specifier this app imports `pkg` by. */
  from: (pkg: string) => string;
  /** Whether the files under `bootstrap/` register `name`; `undefined` when not known. */
  registered: (name: string) => boolean | undefined;
}

/** A block contributed by one installed package. */
interface PackageBlock {
  /** The package that triggers it. */
  pkg: string;
  lines: (ctx: BlockContext) => string[];
}

/**
 * The setup sentence for a package that does nothing until its provider is
 * registered: nothing when it is, the instruction when it is not, and a hedge
 * when this app's providers were not read.
 */
function providerNote(ctx: BlockContext, provider: string, setup: string): string {
  const registered = ctx.registered(provider);
  if (registered === true) return "";
  if (registered === false) return ` It needs ${setup} first — this app does not register it yet.`;
  return ` It needs ${setup}.`;
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
    lines: ({ from }) => [
      "**Data.** Models are Active Record classes in `app/models/`, declared with `@table` and " +
        `\`@column\` decorators; \`DB\` from \`${from("@zerotal/orm")}\` is the query builder. ` +
        "Migrations live in `database/migrations/` — generate with `bun zt make:migration`, " +
        "never hand-edit an applied one. Call `schema` before writing a query or a factory.",
    ],
  },
  {
    pkg: "@zerotal/auth",
    lines: ({ from }) => [
      `**Auth.** \`Auth\` from \`${from("@zerotal/auth")}\` for the current user; policies go in ` +
        "`app/policies/` and are discovered automatically. Do not hand-roll password hashing or " +
        "session handling. `Auth.user()` and `ctx.user` are the app's `User` through one " +
        `declaration, \`declare module "${from("@zerotal/auth")}" { interface UserModel extends User {} }\`, ` +
        "in `bootstrap/app.ts`; once the app has a `User` model, add it if it is missing rather than casting either.",
    ],
  },
  {
    pkg: "@zerotal/validator",
    lines: () => [
      "**Validation.** `FormRequest` subclasses in `app/requests/`, or `validate()` inline. " +
        "Rules are built with `RuleBuilder`, so a typo is a compile error rather than a runtime one.",
    ],
  },
  {
    pkg: "@zerotal/flow",
    lines: () => [
      "**Flow components.** Server-rendered components: a class with state fields and actions, " +
        "rendered as JSX. A component is interactive — state kept between requests, actions " +
        "called over a socket — unless it or a base class sets `static interactive = false`, " +
        "which renders plain HTML with no snapshot. Check the base class before relying on " +
        "either; a page base often turns it off and a page that needs live state turns it " +
        "back on. A page reads a route segment through a field — `@locked @param(Post) post!: Post` " +
        "— rather than by casting `ctx.params`. `bun zt make:flow` scaffolds one.",
    ],
  },
  {
    pkg: "@zerotal/flow-ui",
    lines: () => [
      "**UI kit.** `@zerotal/flow-ui` ships the component set. Check it before writing a button, " +
        "modal, table or form field from scratch.",
    ],
  },
  {
    pkg: "@zerotal/inertia",
    lines: () => [
      "**Inertia.** Pages are React/Vue components under `resources/`; a route handler returns " +
        "`Inertia.render(...)` with the page's props. Props are serialised — do not pass class " +
        "instances. In a Vue app, a page's props are checked against `Inertia.render` only when " +
        "`InertiaTypeOptions` sets `checkVueProps: true` (the Vue starter's `types/inertia.d.ts`), " +
        "and only by `vue-tsc`: plain `tsc` does not read `.vue` files.",
    ],
  },
  {
    pkg: "@zerotal/admin",
    lines: () => [
      "**Admin.** Resources in `app/admin/` describe tables, forms and infolists declaratively. " +
        "`bun zt make:admin-resource` scaffolds one; prefer extending a resource over writing a " +
        "bespoke page.",
    ],
  },
  {
    pkg: "@zerotal/queue",
    lines: (ctx) => [
      "**Background work.** Jobs in `app/jobs/`, dispatched with `.dispatch()`. Anything slower " +
        "than a request belongs in one." +
        providerNote(
          ctx,
          "QueueProvider",
          `\`QueueProvider\` from \`${ctx.from("@zerotal/queue")}\` in the provider list under \`bootstrap/\` ` +
            "and a `config/queue.ts`",
        ) +
        " Once it is registered, `bun zt dev` runs a worker beside the server; in production " +
        "run `bun zt worker` beside it, which runs queued jobs and `app/schedules/` " +
        "(`bun zt queue:work` runs only the queue).",
    ],
  },
  {
    pkg: "@zerotal/cache",
    lines: ({ from }) => [
      `**Cache.** \`Cache\` from \`${from("@zerotal/cache")}\`. Never cache a request-scoped value.`,
    ],
  },
  {
    pkg: "@zerotal/scheduler",
    lines: (ctx) => [
      "**Scheduling.** Schedules in `app/schedules/`, discovered at boot." +
        providerNote(
          ctx,
          "SchedulerProvider",
          `\`SchedulerProvider\` from \`${ctx.from("@zerotal/scheduler")}\` in ` +
            "the provider list under `bootstrap/`",
        ),
    ],
  },
  {
    pkg: "@zerotal/notifications",
    lines: () => [
      "**Notifications.** One class per message in `app/notifications/`: `channels()` names " +
        "where it goes, and each channel has its own method — `toMail()`, `toDatabase()` and " +
        "the rest. `bun zt make:notification` scaffolds one.",
    ],
  },
  {
    pkg: "@zerotal/media",
    lines: ({ from }) => [
      `**Media.** \`${from("@zerotal/media")}\` owns uploads, conversions and the media library.`,
    ],
  },
  {
    pkg: "@zerotal/broadcasting",
    lines: () => [
      "**Realtime.** Channels are declared in the app and authorised server-side. " +
        "`bun zt make:channel` scaffolds one.",
    ],
  },
  {
    pkg: "@zerotal/i18n",
    lines: () => [
      "**Translations.** `@zerotal/i18n`; message files live under `resources/lang/`. " +
        'Translate with `__("English sentence")` — the source string is the key, so there ' +
        "is no catalog for the source language and no key to invent.",
    ],
  },
  {
    pkg: "@zerotal/tenancy",
    lines: () => [
      "**Multi-tenancy.** Tenant resolution is middleware-driven. Anything tenant-scoped must go " +
        "through it rather than reading an id from the request.",
    ],
  },
  {
    pkg: "@zerotal/testing",
    lines: ({ from }) => [
      `**Tests.** \`createTestApp()\` from \`${from("@zerotal/testing")}\` boots a real app; factories and fakes ` +
        "come from the same package. Tests run on `bun test` via `bun zt test`.",
    ],
  },
];

/** The sections of the "What ships" page, in the order it lists them. */
export const CAPABILITY_AREAS = [
  "Accounts and access",
  "Data",
  "Files",
  "Messages and background work",
  "Product features",
  "Security and operations",
  "Testing",
] as const;

export type CapabilityArea = (typeof CAPABILITY_AREAS)[number];

/**
 * One thing an app commonly needs, and what in the framework already does it.
 *
 * `pkg` is the package to install for it, or absent when it ships in the kernel
 * every app has. `doc` is a page name under `/docs/`, which `search_docs` and the
 * vendored copy in this package both answer for; a test holds every one of them
 * to a page that exists.
 */
export interface Capability {
  need: string;
  /** The section it is listed under on the docs' "What ships" page. */
  area: CapabilityArea;
  provides: string;
  pkg?: string;
  doc: string;
}

/**
 * The "before you build it yourself" index.
 *
 * {@link PACKAGE_BLOCKS} only speaks about packages already installed, which is
 * right for "how does this app work" and exactly wrong for discovery: an agent
 * asked for tenancy in an app without `@zerotal/tenancy` was told nothing about
 * it, and wrote tenant scoping, then roles, then an audit log by hand, beside
 * framework packages that do all three. This list names what exists whether or
 * not it is installed, and says which.
 *
 * One line each, pointing at the page that owns the subject. A capability that
 * does not ship is never listed — an index that sends an agent looking for
 * something that is not there is worse than no index.
 */
export const CAPABILITIES: readonly Capability[] = [
  {
    need: "Multi-tenancy",
    area: "Accounts and access",
    provides: "tenant resolvers and tenant-scoped models",
    pkg: "@zerotal/tenancy",
    doc: "tenancy",
  },
  {
    need: "Roles and permissions",
    area: "Accounts and access",
    provides: "the `Roles` and `Permissions` model mixins, `Auth.can()`",
    pkg: "@zerotal/auth",
    doc: "authorization",
  },
  {
    need: "Policies",
    area: "Accounts and access",
    provides: "policy classes in `app/policies/`, discovered automatically",
    pkg: "@zerotal/auth",
    doc: "authorization",
  },
  {
    need: "Two-factor sign-in",
    area: "Accounts and access",
    provides: "TOTP codes and recovery codes",
    pkg: "@zerotal/auth",
    doc: "roles-and-2fa",
  },
  {
    need: "Passkeys, magic links, email codes",
    area: "Accounts and access",
    provides: "`PasskeyService` and passwordless login",
    pkg: "@zerotal/auth",
    doc: "authentication",
  },
  {
    need: "Sign in with GitHub, Google or Apple",
    area: "Accounts and access",
    provides: "OAuth drivers",
    pkg: "@zerotal/auth",
    doc: "social",
  },
  {
    need: "Password reset",
    area: "Accounts and access",
    provides: "`PasswordBroker`",
    pkg: "@zerotal/auth",
    doc: "password-reset",
  },
  {
    need: "Email verification",
    area: "Accounts and access",
    provides: "signed links and `ValidateSignatureMiddleware`",
    pkg: "@zerotal/auth",
    doc: "email-verification",
  },
  {
    need: "An audit trail",
    area: "Accounts and access",
    provides: "the `Auditable` mixin and manual audit events",
    pkg: "@zerotal/audit",
    doc: "audit",
  },
  {
    need: "An admin panel",
    area: "Product features",
    provides: "declarative resources, tables, forms and dashboards",
    pkg: "@zerotal/admin",
    doc: "admin",
  },
  {
    need: "Per-tenant settings",
    area: "Product features",
    provides:
      "typed defaults in code with tenant and user overrides, hidden not deleted, audited, with an admin screen",
    pkg: "@zerotal/settings",
    doc: "settings",
  },
  {
    need: "Mail, SMS and in-app notifications",
    area: "Messages and background work",
    provides: "notification classes, one per message",
    pkg: "@zerotal/notifications",
    doc: "notifications",
  },
  {
    need: "File uploads and image conversions",
    area: "Files",
    provides: "media attached to models",
    pkg: "@zerotal/media",
    doc: "media",
  },
  {
    need: "File storage",
    area: "Files",
    provides: "local and S3-compatible disks",
    doc: "storage",
  },
  {
    need: "Background jobs",
    area: "Messages and background work",
    provides:
      "job classes and a worker, on the app's own database (SQLite, PostgreSQL, MySQL) or Redis",
    pkg: "@zerotal/queue",
    doc: "queue",
  },
  {
    need: "Scheduled tasks",
    area: "Messages and background work",
    provides: "`Schedule` classes in `app/schedules/`",
    pkg: "@zerotal/scheduler",
    doc: "scheduler",
  },
  {
    need: "Caching",
    area: "Data",
    provides: "SQLite, Redis and memory drivers with tags",
    pkg: "@zerotal/cache",
    doc: "cache",
  },
  {
    need: "Realtime updates",
    area: "Product features",
    provides: "authorised broadcast channels",
    pkg: "@zerotal/broadcasting",
    doc: "broadcasting",
  },
  {
    need: "Translations",
    area: "Product features",
    provides: "`__()` with plurals and per-request locale",
    pkg: "@zerotal/i18n",
    doc: "i18n",
  },
  {
    need: "Calls to a language model",
    area: "Product features",
    provides: "`Ai.text()`, `Ai.object()`, `Ai.agent()`",
    pkg: "@zerotal/ai",
    doc: "ai",
  },
  {
    need: "Rate limiting",
    area: "Security and operations",
    provides: "`ThrottleMiddleware` and named limiters",
    doc: "rate-limiting",
  },
  { need: "Locks across processes", area: "Data", provides: "`zerotal/lock`", doc: "lock" },
  {
    need: "Encryption and hashing",
    area: "Security and operations",
    provides: "encrypt, hash and sign helpers",
    doc: "encryption",
  },
  {
    need: "Maintenance mode and a pre-launch gate",
    area: "Security and operations",
    provides: "the site gate",
    doc: "site-gate",
  },
  {
    need: "Health checks",
    area: "Security and operations",
    provides: "a `/health` endpoint with your own checks",
    doc: "health",
  },
  {
    need: "Database backups",
    area: "Data",
    provides: "`bun zt db:backup` (SQLite)",
    doc: "commands",
  },
  {
    need: "Seed and demo data",
    area: "Data",
    provides: "seeders and model factories",
    doc: "seeding",
  },
  {
    need: "Validation",
    area: "Data",
    provides: "`FormRequest` classes and `validate()`",
    pkg: "@zerotal/validator",
    doc: "validator",
  },
  {
    need: "Tests against a booted app",
    area: "Testing",
    provides: "`createTestApp()`, factories and fakes",
    pkg: "@zerotal/testing",
    doc: "testing",
  },
  {
    need: "A production dashboard",
    area: "Security and operations",
    provides: "requests, jobs, errors and alerts",
    pkg: "@zerotal/monitor",
    doc: "monitor",
  },
  {
    need: "Tracing",
    area: "Security and operations",
    provides: "spans with OTLP export",
    pkg: "@zerotal/telemetry",
    doc: "telemetry",
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
  const bundle = installed.has("zerotal");
  const providers = options.shape?.providers ? new Set(options.shape.providers) : undefined;
  const ctx: BlockContext = {
    from: (pkg) =>
      bundle && _BUNDLED_PACKAGES.includes(pkg) ? pkg.replace("@zerotal/", "zerotal/") : pkg,
    registered: (name) => providers?.has(name),
  };
  const sections: string[] = [
    "## Zerotal",
    "",
    "This is a Zerotal app: a Bun-native, full-stack TypeScript framework. Bun executes",
    "`.ts` directly — there is no build step, and what you write is what runs.",
    "",
    toolSection(options.serverName),
    "",
    conventionSection(bundle, options.shape?.routing),
    "",
    commandSection(),
  ];

  const blocks = PACKAGE_BLOCKS.filter((block) => installed.has(block.pkg));
  if (blocks.length > 0) {
    sections.push(
      "",
      "### What this app has",
      "",
      ...blocks.flatMap((block) => [...block.lines(ctx), ""]),
    );
  }

  sections.push("", discoverySection(installed));

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

/**
 * Where classes go and where imports come from.
 *
 * @param bundle - The app declares the `zerotal` bundle. Its starters do, and import
 *   `zerotal/orm` rather than `@zerotal/orm`; telling such an app to import the
 *   scoped name sends an agent to a package that is only on disk because the
 *   bundle put it there.
 * @param routing - Which routing directories this app uses, from its shape. Absent,
 *   both styles are listed, as they always were.
 */
function conventionSection(bundle: boolean, routing?: ProjectShape["routing"]): string {
  const styles = routing && (routing.files || routing.registered) ? routing : undefined;
  const dirs = [
    ...(!styles || styles.files ? ["app/routes/"] : []),
    ...(!styles || styles.registered ? ["routes/"] : []),
    ...(!styles || styles.controllers ? ["app/controllers/"] : []),
    "app/models/",
    "app/middleware/",
    "app/policies/",
    "app/requests/",
    "app/jobs/",
    "app/events/",
    "app/listeners/",
    "app/observers/",
    "app/notifications/",
    "app/commands/",
    "app/schedules/",
    "config/",
    "database/migrations/",
    "tests/",
  ];
  const grid: string[] = [];
  for (let i = 0; i < dirs.length; i += 4) {
    grid.push(
      dirs
        .slice(i, i + 4)
        .map((dir, j, row) => (j === row.length - 1 ? dir : dir.padEnd(22)))
        .join(""),
    );
  }

  return [
    "### Conventions",
    "",
    "Classes are discovered by directory. Put a file in the right place and it registers",
    "itself; no manifest to update.",
    "",
    "```text",
    ...grid,
    "```",
    "",
    routingSentence(styles),
    "",
    ...(bundle
      ? [
          "Imports follow one rule: this app depends on the `zerotal` bundle, so the kernel",
          "and the packages it bundles are imported through it — " +
            _BUNDLED_PACKAGES
              .map((pkg) => `\`${pkg.replace("@zerotal/", "zerotal/")}\``)
              .join(", ") +
            " — and any other package by its own name. An `@zerotal/orm` import would reach a " +
            "package this app does not declare.",
          "",
          "```ts",
          'import type { HttpContext } from "zerotal";',
          'import { route } from "zerotal/routes";',
          'import { DB } from "zerotal/orm";',
          "```",
        ]
      : [
          "Imports follow one rule: the kernel comes from `zerotal` (and `zerotal/routes`,",
          "`zerotal/http`, …), everything else from its own package.",
          "",
          "```ts",
          'import type { HttpContext } from "zerotal";',
          'import { route } from "zerotal/routes";',
          'import { DB } from "@zerotal/orm";',
          "```",
        ]),
  ].join("\n");
}

/** How a request finds its handler in this app, in the style it already uses. */
function routingSentence(routing: ProjectShape["routing"] | undefined): string {
  const files =
    "each file serves the path it sits at and exports `GET`, `POST` " +
    "and the rest; a `[param]` folder or file is a parameter, and a `(group)` folder adds " +
    "the middleware in its `_middleware.ts` without adding to the path";
  if (routing?.files && !routing.registered) {
    return `Routes are files under \`app/routes/\`: ${files}. Add a route by adding a file.`;
  }
  if (routing?.files && routing.registered) {
    return (
      `This app uses both routing styles. Files under \`app/routes/\` route themselves — ${files}; \`routes/\` ` +
      "registers the rest in code. Read both before adding a route, and follow whichever " +
      "already serves its neighbours."
    );
  }
  if (routing?.registered) {
    return (
      "Routes are registered in code in `routes/`" +
      (routing.controllers ? ", pointing at controllers in `app/controllers/`" : "") +
      ". Add a route there."
    );
  }
  return (
    `Routes are either files under \`app/routes/\` — ${files} — or registered in code in \`routes/\`. Check ` +
    "which this app uses before adding one."
  );
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
 * The capability index, marked against what this app has.
 *
 * A list, not a table: a Markdown table is padded to its widest cell by the
 * project's formatter, so a generated one fails `prettier --check` until it is
 * reformatted, and a reformatted one no longer matches what `doctor` regenerates.
 */
function discoverySection(installed: ReadonlySet<string>): string {
  const line = (capability: Capability): string => {
    const where =
      capability.pkg === undefined
        ? "Built in"
        : installed.has(capability.pkg)
          ? `\`${capability.pkg}\`, installed`
          : `\`${capability.pkg}\` — \`bun add ${capability.pkg}\``;
    return `- **${capability.need}:** ${capability.provides}. ${where}; page \`${capability.doc}\`.`;
  };

  return [
    "### Before you build it yourself",
    "",
    "The framework already ships each of these. Check this list, then `search_docs`, before",
    "writing one by hand — and ask before installing a package the app does not have yet.",
    "Each page is at `https://zerotal.dev/docs/<page>` and in `search_docs`.",
    "",
    ...CAPABILITIES.map(line),
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
