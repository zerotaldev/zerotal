# @zerotal/audit

> Automatic, zero-boilerplate audit logging for Zerotal models and custom events.

Captures every create, update, and delete on audited models — with old and new
values, the authenticated actor, and request metadata — and stores them in a
queryable `audit_logs` table. Custom events can be logged manually via the `Audit`
facade. **Beta** — APIs are stable but rough edges remain.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/audit
```

## Setup

Register the provider in `bootstrap/providers.ts`:

```ts
import { AuditProvider } from "@zerotal/audit";

export default [
  DatabaseProvider,
  SessionProvider,
  AuthProvider,
  AuditProvider, // add after DatabaseProvider
];
```

The `audit_logs` table is created automatically on boot — no migration needed.
Configure the driver and table in `config/audit.ts`:

```ts
// config/audit.ts
import { AuditConfig } from "@zerotal/audit";

export default AuditConfig({
  driver: "database", // 'database' | 'null'
  table: "audit_logs",
  pruneKeep: 0, // 0 = unlimited; set e.g. 100 to keep last N per model
  captureRequest: true, // attach IP, user-agent, URL automatically
});
```

## Usage

Compose `Auditable` with `BaseModelWith` (like any other mixin) to record `created`,
`updated`, and `deleted` automatically. Configure it with overridable static fields:

```ts
import { BaseModelWith, column, table } from "@zerotal/orm";
import { Authenticatable } from "@zerotal/auth";
import { Auditable } from "@zerotal/audit";

@table("users")
export class User extends BaseModelWith(Authenticatable, Auditable) {
  protected static auditExcept = ["password", "rememberToken"];

  @column() name!: string;
  @column() email!: string;
  @column() password?: string;
}
```

For a model you'd rather not wrap, register it at boot in a provider's
`onBooted()`:

```ts
import { registerAudit } from "@zerotal/audit";

registerAudit(User);
```

Log custom events via the `Audit` facade. Within a request it reads the
authenticated user and request details automatically; outside one, pass the actor
explicitly:

```ts
import { Audit } from "@zerotal/audit";

// Pass the model instance — auditable_type/id are derived from it (no orphans):
await Audit.log("login.success", user, { tags: { method: "github_oauth" } });

// On an Auditable instance, the shorthand reads even cleaner:
await user.auditLog("login.success", { tags: { method: "github_oauth" } });

// Outside a request (queue job, CLI) — pass the actor explicitly:
await Audit.log("subscription.renewed", sub, { actor_type: "user", actor_id: sub.userId });
```

Query through the `Audit` facade or an instance — both return a chainable `AuditLog`
builder (`where` · `orderBy` · `desc()` / `asc()` · `limit` · `get` · `paginate`):

```ts
import { Audit } from "@zerotal/audit";

const history = await Audit.logs(User, user.id).desc().limit(25).get();
const fromInstance = await user.auditLogs().desc().limit(25).get();
const logins = await Audit.logsOfEvent("login.success").get();
const byUser = await Audit.logsByActor(user.id).get();
const page = await Audit.logs(User, user.id).orderBy("id", "desc").paginate(20, 1);
```

## Exports

- `Auditor` — the core service: records events and exposes `logs()` / `logsByActor()` / `logsOfEvent()`.
- `Audit` — facade over the Auditor (`Audit.log(...)`, `Audit.logs(...)`).
- `AuditLog` — the queryable `BaseModel` behind the builders.
- `AuditObserver` — ORM lifecycle observer that emits model events.
- `AuditProvider` — wires the auditor, driver, and observer.
- `Auditable`, `registerAudit` — opt a model in via mixin (adds `auditLog()` / `auditLogs()`) or at boot.
- Drivers: `AuditDriver` (interface), `DatabaseDriver`, `NullDriver`.
- `AuditConfig` / `AuditConfigShape` — config factory and shape.
- Types: `AuditEvent`, `AuditRecord`, `AuditPayload`, `AuditableOptions`, `AuditableRef`, `InstanceAuditPayload`.

## Documentation

- [Audit](../../docs/audit.md)
