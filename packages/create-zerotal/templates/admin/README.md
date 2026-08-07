# {{name}}

An admin panel: resources, authentication, dashboard widgets and seeded demo data.


Built with [Zerotal](https://zerotal.dev) — a full-stack TypeScript framework for Bun.

## Requirements

- [Bun](https://bun.sh) 1.3.14 or newer. Node.js is not supported: Zerotal uses
  Bun-native APIs throughout.

## Getting started

```bash
bun install
bun run dev
```

The dev server prints a local URL and a network one, so you can open the app on
another device on the same Wi-Fi.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Start the dev server with hot reload |
| `bun run start` | Start the server without dev tooling |
| `bun run test` | Run the test suite |
| `bun run typecheck` | Type-check without emitting |
| `bun run seed` | Re-seed the demo data |

## Configuration

Environment variables live in `.env`, documented in `.env.example`. `APP_KEY`
was generated for this project when it was scaffolded — keep it out of version
control, and use a different one per environment.

## Documentation

Full documentation is at [zerotal.dev/docs](https://zerotal.dev/docs).
