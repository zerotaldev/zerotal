# @zerotal/arch

**Maturity: beta.** The API is close to final and breaking changes are rare, called out
in release notes with migration steps — but a minor release may still contain one. See
the [support policy](https://zerotal.dev/docs/support-policy#maturity-levels).

The Zerotal agent surface: an MCP server that hands a coding agent the framework's
machine-readable truth about your app.

Not a documentation search over prose about an API — the API itself. Zerotal commits an
`api-surface.md` per package holding every export's exact TypeScript signature,
regenerated and diffed by CI on every change. `zt doctor` already returns structured
findings with a fix attached to each. The router knows its routes and the ORM knows its
columns. This package exposes all of it over the protocol agents speak.

## Install

```bash
bun add -d @zerotal/arch
```

```typescript
// bootstrap/providers.ts
import { ArchProvider } from "@zerotal/arch";

export default [DatabaseProvider, ArchProvider];
```

```bash
bun zt arch:install     # writes .mcp.json, AGENTS.md and a CLAUDE.md shim
```

Re-running is safe: generated regions are fenced with markers and only those regions are
ever rewritten.

## Tools

| Tool                  | Answers                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `app_info`            | Bun version, boot mode, providers, and the version and maturity of every installed `@zerotal` package. |
| `api_surface`         | Every export of a package with its full signature.                                                     |
| `search_docs`         | The framework docs for the version installed here.                                                     |
| `routes`              | The routes actually registered, with their names.                                                      |
| `schema`              | Tables, columns, indexes — what the models declare.                                                    |
| `logs` / `last_error` | The app's own structured trail.                                                                        |
| `baselines`           | The quality ratchets and the commands that check them.                                                 |
| `doctor`              | Every health check, with the fix beside each finding.                                                  |

All read-only. All publish an `outputSchema`.

## How it runs

The server is a bin that **never boots your application**. MCP's stdio transport forbids
writing anything to stdout that is not a protocol message, and a booted app prints. The
tools that need an app spawn one per call instead — which also means every answer
describes the code as it is now, not as it was when a long-lived server started.

It speaks both eras of MCP: the stateless `2026-07-28` revision, including the mandatory
`server/discover`, and the `initialize` handshake that shipping clients still open with.

## Documentation

<https://zerotal.dev/docs/arch>

## License

MIT
