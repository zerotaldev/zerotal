---
title: Agent Surface
description: Give coding agents the framework's machine-readable truth — exact signatures, live routes and schema, version-matched docs, and a health check they can act on.
---

# Agent Surface

`@zerotal/arch` is an MCP server that hands a coding agent what the framework already
knows about your app: the exact signature of every export, the routes it actually
registered, what the models declare, the documentation for the version you installed,
and a health check whose findings come with the fix attached.

The premise is that none of this needs to be inferred. Zerotal produces it mechanically
already — `api-surface.md` is regenerated and diffed by CI on every change, `zt doctor`
returns structured findings, the router knows its routes and the ORM knows its columns.
This package exposes it over the protocol agents speak.

## Install

```bash
# in your project root
bun add -d @zerotal/arch
```

Register the provider in `bootstrap/providers.ts`:

```typescript fragment
// bootstrap/providers.ts
import { ArchProvider } from "@zerotal/arch";

export default [DatabaseProvider, ArchProvider];
```

Then wire it into whichever agents you use:

```bash
# in your project root
bun zt arch:install
```

That writes three things and restarts nothing:

| File        | What it is                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `.mcp.json` | Registers the server so an agent can call its tools. A `.cursor/` or `.vscode/` directory gets its own config too. |
| `AGENTS.md` | The instructions, composed from the packages you actually installed.                                               |
| `CLAUDE.md` | A one-line shim importing `AGENTS.md`.                                                                             |

Restart your agent afterwards so it picks up the new server.

> **Note** — `ArchProvider` declares `environments: ["console"]`. It adds three commands
> and contributes nothing to a request, so a web process never loads it.

## The tools

| Tool                  | Answers                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_info`            | Bun version, boot mode, registered providers, and the version and [maturity](/docs/support-policy#maturity-levels) of every installed `@zerotal` package. |
| `api_surface`         | Every export of a package with its full TypeScript signature, class members included. Takes an optional `symbol` filter.                                  |
| `search_docs`         | These pages, for the version installed here. Returns the matching section, not the whole page.                                                            |
| `routes`              | The registered routes with their names, controllers and middleware — including ones a provider added programmatically.                                    |
| `schema`              | What the models declare: tables, primary keys, timestamps, soft deletes, and every column with its flags.                                                 |
| `logs` / `last_error` | The app's own trail from `storage/logs`, already structured. `level` acts as a floor, so `warn` includes errors.                                          |
| `baselines`           | The quality ratchets this project records and the command that checks each.                                                                               |
| `doctor`              | Every health check, with the fix beside each finding.                                                                                                     |

Every tool is read-only, and every one publishes an `outputSchema` and returns
`structuredContent` alongside its text.

### The two that carry the most

**`api_surface`** is the reason the rest is worth building. Where a documentation search
can tell an agent that a fluent builder exists, this hands over the call it has to write
for `tsc` to accept it:

```text
class Collection = {
  new <T>(items?: T[]): Collection<T>
  static make<T>(items: T[]): Collection<T>
  filter(predicate: (item: T, index: number) => boolean): Collection<T>
  …
}
```

It reads the snapshot from `node_modules`, so the answer describes the version this app
runs rather than whatever is current.

**`doctor`** is the one to end a task with. Every finding carries a `fix`, which is what
makes "the app is healthy" a claim an agent can verify rather than assert.

## Commands

| Command                     | What it does                                                       |
| --------------------------- | ------------------------------------------------------------------ |
| `bun zt arch:install`       | Write the MCP config and the instruction files.                    |
| `bun zt arch:update`        | The same command — re-running it _is_ the update.                  |
| `bun zt arch:probe <topic>` | Print one JSON report: `doctor`, `routes`, `schema` or `app-info`. |

Both writers take `--dry`, which prints what would change and writes nothing.

### Re-running is safe

Generated content lives between markers:

```markdown
<!-- zerotal:arch:start -->

…generated…
<!-- zerotal:arch:end -->
```

`arch:update` replaces what is between them and nothing else, so anything you write
above, below, or after the block survives every framework upgrade. The MCP config is
merged the same way — other servers in the file are left exactly as they were.

A file whose markers are damaged, or a `.mcp.json` that is not valid JSON, is reported
and left completely alone. Guessing where a half-marked block was meant to end is how a
tool eats a paragraph nobody kept a copy of.

## How it runs

The server is a bin, not a `zt` command, and it never boots your application:

```json
// .mcp.json
{
  "mcpServers": {
    "zerotal": {
      "command": "bun",
      "args": ["node_modules/@zerotal/arch/src/bin/mcp.ts"]
    }
  }
}
```

Two reasons, and both matter.

**The protocol forbids noise.** MCP's stdio transport says a server must write nothing to
stdout that is not a protocol message, and a stray line does not degrade the session — it
desynchronises the client's parser and corrupts every message after it. A booted app
prints: banners, provider notices, warnings. A process that never boots one cannot.

**Answers have to be current.** The caller is an agent editing the code between calls. A
long-lived server holding a booted app would answer `routes` from the state it started
with. So the tools that need an app spawn one per call — `bun zt.ts arch:probe <topic>` —
and pay about a second for an answer that is true right now. There is no cache anywhere
in that path, deliberately.

The tools that read files rather than the app — `api_surface`, `search_docs`,
`baselines`, `logs` — need no app at all and work in a project that will not boot, which
is exactly when an agent needs them most.

## Protocol support

The server speaks both eras of MCP and picks per request:

- **Modern** (`2026-07-28`) — stateless, with the protocol version in each request's
  `_meta`. `server/discover` is implemented, which is also the probe a dual-era client
  uses on stdio to decide it need not fall back.
- **Legacy** (`2025-11-25` and earlier) — the `initialize` handshake, which is still what
  most shipping clients open with.

A client that opens with `initialize` gets legacy semantics; one that tags its requests
gets modern ones, including `resultType`, `ttlMs` and `cacheScope` on list results.

## Configuration

Only the install side is configurable — the server reads no config, because it boots no
app to read one from.

```typescript
// config/arch.ts
import { ArchConfig } from "@zerotal/arch";

export default ArchConfig({ claudeFile: false });
```

| Field           | Required | Default       | Description                                         |
| --------------- | -------- | ------------- | --------------------------------------------------- |
| `agentsFile`    | no       | `true`        | Write `AGENTS.md`, the cross-tool instruction file. |
| `claudeFile`    | no       | `true`        | Write a `CLAUDE.md` importing it.                   |
| `mcpConfig`     | no       | `true`        | Write the MCP client configuration.                 |
| `mcpConfigPath` | no       | `".mcp.json"` | Where that configuration goes.                      |
| `serverName`    | no       | `"zerotal"`   | The key the server is registered under.             |

## Building on it

The transport is exported separately from the tools, on the `@zerotal/arch/mcp` subpath.
A tool is a plain object with a schema and a `run`, so you can serve your own alongside
these — or serve these over a transport of your own.

```typescript fragment
import { McpServer, serveStdio } from "@zerotal/arch/mcp";
import { archTools, vendoredDocsDir, spawnProbe } from "@zerotal/arch";

const tools = archTools({
  root: process.cwd(),
  docsDir: vendoredDocsDir(),
  probe: spawnProbe(),
});

await serveStdio({
  server: new McpServer({
    identity: { name: "my-app", title: "My App", version: "1.0.0" },
    tools: [...tools, myOwnTool],
  }),
});
```

`ArchTool`, `ToolOutcome` and `ToolContext` are the three types you need; `ProbeRunner`
is the seam that lets a tool's tests answer from a fixture instead of booting anything.

## References

| Member                                          | Signature                                                         | Description                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ArchProvider`                                  | `class ArchProvider extends ServiceProvider`                      | Registers `arch:install`, `arch:update` and `arch:probe`, and one doctor check. |
| `ArchConfig`                                    | `ArchConfig(options?: Partial<ArchConfigShape>): ArchConfigShape` | Config factory for the install side.                                            |
| `ArchConfigShape`                               | `interface ArchConfigShape`                                       | What `arch:install` writes, and under what name.                                |
| `ArchError`                                     | `class ArchError extends ZerotalError`                            | Base for this package's errors.                                                 |
| `NoProjectRootError`                            | `class NoProjectRootError extends ArchError`                      | Thrown when `arch:install` runs outside a project.                              |
| `archTools`                                     | `archTools(ctx: ToolContext): ArchTool[]`                         | Every tool, in listing order.                                                   |
| `ToolContext`                                   | `interface ToolContext`                                           | The project root, the docs corpus, and a `ProbeRunner`.                         |
| `vendoredDocsDir`                               | `vendoredDocsDir(): string`                                       | Path to the documentation shipped inside this package.                          |
| `spawnProbe`                                    | `spawnProbe(options?: SpawnProbeOptions): ProbeRunner`            | The runner that spawns `zt arch:probe`.                                         |
| `findApp`                                       | `findApp(start: string): Promise<{ root, entry } \| undefined>`   | The nearest enclosing Zerotal app.                                              |
| `ProbeRunner`                                   | `interface ProbeRunner`                                           | The seam a tool reaches a booted app through.                                   |
| `ProbeResult`                                   | `type ProbeResult`                                                | A probe's answer, or the reason there is none.                                  |
| `SpawnProbeOptions`                             | `interface SpawnProbeOptions`                                     | `cwd` and `timeoutMs` for the runner.                                           |
| `probe`                                         | `probe(topic: ProbeTopic, app: Application): Promise<unknown>`    | Run one topic against a booted app.                                             |
| `PROBE_TOPICS`                                  | `readonly ProbeTopic[]`                                           | The topics `arch:probe` accepts.                                                |
| `ProbeTopic`                                    | `type ProbeTopic`                                                 | `"doctor" \| "routes" \| "schema" \| "app-info"`.                               |
| `isProbeTopic`                                  | `isProbeTopic(value: string): value is ProbeTopic`                | Narrow a string to a topic.                                                     |
| `DoctorReport` / `DoctorFinding`                | `interface`                                                       | What the `doctor` tool returns.                                                 |
| `RouteReport` / `RouteEntry`                    | `interface`                                                       | What the `routes` tool returns.                                                 |
| `SchemaReport` / `SchemaModel` / `SchemaColumn` | `interface`                                                       | What the `schema` tool returns.                                                 |
| `AppInfo` / `InstalledPackage`                  | `interface`                                                       | What the `app_info` tool returns.                                               |
| `detectAgents`                                  | `detectAgents(root: string): Promise<Detected>`                   | Which agents a project is set up for.                                           |
| `Detected` / `McpTarget`                        | `interface`                                                       | The detection result and one client's config location.                          |
| `applyMcpConfig`                                | `applyMcpConfig(existing, name, target): ConfigOutcome`           | Merge this server into an MCP config.                                           |
| `ConfigOutcome`                                 | `type ConfigOutcome`                                              | Created, updated, unchanged, or a conflict.                                     |
| `serverEntry`                                   | `serverEntry(): Record<string, unknown>`                          | The command and args a client is given.                                         |
| `SERVER_ENTRY_PATH`                             | `const SERVER_ENTRY_PATH: string`                                 | Where the server lives in `node_modules`.                                       |
| `applyBlock`                                    | `applyBlock(existing, content, preamble?): BlockOutcome`          | Replace a managed block, preserving everything else.                            |
| `BlockOutcome`                                  | `type BlockOutcome`                                               | The result of a block write.                                                    |
| `fence`                                         | `fence(content: string): string`                                  | Wrap content in its markers.                                                    |
| `BLOCK_START` / `BLOCK_END`                     | `const`                                                           | The markers themselves.                                                         |
| `buildGuidelines`                               | `buildGuidelines(options: GuidelineOptions): string`              | The generated `AGENTS.md` body.                                                 |
| `GuidelineOptions`                              | `interface GuidelineOptions`                                      | Installed packages and the server name.                                         |
| `agentsPreamble`                                | `agentsPreamble(): string`                                        | The prose written above the block on creation.                                  |
| `claudeShim`                                    | `claudeShim(): string`                                            | The `CLAUDE.md` that imports `AGENTS.md`.                                       |

The transport is on the `@zerotal/arch/mcp` subpath: `McpServer`, `McpServerOptions`,
`serveStdio`, `StdioOptions`, `decodeFrame`, `encodeFrame`, `DecodedFrame`, `success`,
`failure`, `ArchTool`, `ToolOutcome`, `JsonSchema`, `ServerIdentity`, `Era`,
`JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcSuccess`, `JsonRpcFailure`, `JsonRpcId`,
`RpcError`, `Meta`, `MODERN_VERSION`, `LEGACY_VERSIONS` and `SUPPORTED_VERSIONS`.

## What `stable` covers here

The usual promise — anything importable without an `@internal` marker keeps its
shape for the rest of the 1.x line — and one more, because this package's real
interface is not its exports.

**The MCP tool contract is covered.** Tool names, the arguments they accept, and
the shape of what they return do not change within 1.x. That is the surface an
agent client is configured against: a renamed tool or a dropped field breaks
every `.mcp.json` pointing at this server, and none of it is visible to a
type-level check — `archTools = (ctx) => ArchTool[]` is byte-identical whatever
the tools are called. `mcp-surface.md` records all nine and CI diffs it.

**The protocol revision is not.** Which version of the Model Context Protocol the
server speaks follows the protocol, not this package's major version. A revision
that requires a transport change will land in a minor release, described in the
notes.

**The writers behind `arch:install` are not.** `detectAgents`, `applyMcpConfig`,
`applyBlock`, `buildGuidelines` and the rest are `@internal`: they exist for the
command, and the format of the files it writes is not a promise.

## Next steps

- [Commands](/docs/commands) — the full `bun zt` vocabulary an agent is told about.
- [Package Development](/docs/package-development) — contributing doctor checks of your own.
- [Support policy](/docs/support-policy#maturity-levels) — what `stable` promises.
