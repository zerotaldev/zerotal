# zerotal

> Zerotal, one install — the meta package for the stable set.

```bash
bun add zerotal
```

`zerotal` is a thin re-export layer over the [`@zerotal/*`](https://github.com/zerotaldev/zerotal) scope. The root import is `@zerotal/core`; each stable package is one subpath away:

```ts
import { Application, Router } from "zerotal";
import { Model } from "zerotal/orm";
import { Auth } from "zerotal/auth";
```

| Subpath             | Re-exports           |
| ------------------- | -------------------- |
| `zerotal`           | `@zerotal/core`      |
| `zerotal/auth`      | `@zerotal/auth`      |
| `zerotal/cache`     | `@zerotal/cache`     |
| `zerotal/client`    | `@zerotal/client`    |
| `zerotal/orm`       | `@zerotal/orm`       |
| `zerotal/queue`     | `@zerotal/queue`     |
| `zerotal/scheduler` | `@zerotal/scheduler` |
| `zerotal/session`   | `@zerotal/session`   |
| `zerotal/testing`   | `@zerotal/testing`   |
| `zerotal/validator` | `@zerotal/validator` |

Core's own subpaths are mirrored 1:1, so `zerotal` is a full drop-in for `@zerotal/core`: `zerotal/logger`, `zerotal/lock`, `zerotal/storage`, `zerotal/config`, `zerotal/view`, `zerotal/helpers`, `zerotal/facades`, `zerotal/http`, `zerotal/env`, `zerotal/carbon`, `zerotal/contracts`, `zerotal/commands`, `zerotal/assets`, `zerotal/security`, `zerotal/health`, `zerotal/metrics`, `zerotal/dev`, `zerotal/build` — and `jsx-runtime`, so `"jsxImportSource": "zerotal"` works for server JSX views. The one exception is `@zerotal/core/macros/config` (a Bun macro): import it from core directly.

There is no behaviour here and no version skew: the meta package pins the same monorepo version as every `@zerotal/*` package it re-exports. Installing a scoped package directly is always equivalent — this package exists so a new app needs exactly one dependency to start.

Beta and experimental packages (`@zerotal/flow`, `@zerotal/flow-ui`, `@zerotal/admin`, `@zerotal/devtools`, ...) are not bundled; install them individually while they harden.

Scaffolding a new app? Use `bun create zerotal my-app` instead — it wires an application skeleton, not just dependencies.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.
