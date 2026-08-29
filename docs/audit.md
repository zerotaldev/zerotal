---
title: Audit
description: Capture every model write and custom event — with old/new values, actor, and request metadata — into a queryable audit_logs table.
---

# Audit

`@zerotal/audit` provides automatic, zero-boilerplate audit logging for Zerotal
models and manual events. Every create, update, and delete is captured — with old
and new values, the authenticated actor, and request metadata — and stored in a
queryable `audit_logs` table.

## Getting Started

`@zerotal/audit` is a workspace package, so there is no separate install step:

```bash
# in your project root
bun add @zerotal/audit
```

## Register the provider

Add `AuditProvider` to the providers array in `bootstrap/providers.ts`, after
`DatabaseProvider` (the audit table lives in your database):

```ts fragment
// bootstrap/providers.ts
import { AuditProvider } from "@zerotal/audit";

export default [
  DatabaseProvider,
  SessionProvider,
  AuthProvider,
  AuditProvider, // ← add after DatabaseProvider
  // ...
];
```

Registering the provider switches on the following:

- `onRegister` — binds the `Auditor` service as the `"audit"` singleton and
  registers the schema concern that provisions the `audit_logs` table.
- `onBooted` — drains the pending `Auditable` registry, wiring each composed model
  to the live `Auditor` once the container is ready.

> **Note** — No migration is required. A boot-time schema concern creates the
> `audit_logs` table automatically (idempotently, and skipped for the `null`
> driver). Register the provider and the table appears on first boot.

## Configuration

Create `config/audit.ts` with the `AuditConfig()` helper so every field stays
type-checked. The file is auto-discovered — its settings are namespaced under
`audit` in the config tree:

```ts
// config/audit.ts
import { AuditConfig } from "@zerotal/audit";

export default AuditConfig({
  driver: "database", // 'database' | 'null'
  table: "audit_logs",
  pruneKeep: 0, // 0 = unlimited; cap records kept per model instance
  captureRequest: true, // attach IP, user-agent, URL automatically
});
```

| Field            | Required | Default        | Description                                                           |
| ---------------- | -------- | -------------- | --------------------------------------------------------------------- |
| `driver`         | yes      | `"database"`   | Storage backend — `"database"` or `"null"`.                           |
| `table`          | no       | `"audit_logs"` | Table name used by the database driver.                               |
| `pruneKeep`      | no       | `0`            | Max audit records kept per model instance. `0` = unlimited.           |
| `captureRequest` | no       | `true`         | Attach IP, user-agent, and URL from the active request automatically. |

## Auditing models

### The Auditable mixin

Compose `Auditable` into any `Model` subclass. The audit system hooks
into the ORM lifecycle and records `created`, `updated`, and `deleted` events
automatically. Like every Zerotal mixin it takes only `(Base)` — configure it with
overridable static fields on the model.

```ts
// app/models/User.ts
import { Auditable } from "@zerotal/audit";
import { Model, column, table } from "@zerotal/orm";

@table("users")
export class User extends Model.using(Auditable) {
  protected static auditExcept = ["password", "rememberToken"];

  @column({ type: "string" }) name: string;
  @column({ type: "string" }) email: string;
  @column({ type: "string" }) password?: string;
  @column({ type: "string" }) rememberToken?: string;
}
```

`Auditable` composes with the auth mixins as the outermost wrapper:

```ts fragment
// app/models/User.ts
export class User extends Auditable(WithRoles(WithPermissions(AuthUser))) {
  protected static auditExcept = ["password"];
}
```

> **Danger** — Never audit columns containing credentials. Exclude `password`,
> `rememberToken`, API tokens, etc. via `auditExcept` (shown above).

Configure auditing with overridable static fields, read per event from the
concrete model:

| Static field  | Type       | Description                                                             |
| ------------- | ---------- | ----------------------------------------------------------------------- |
| `auditOnly`   | `string[]` | Allowlist — only these columns appear in `old_values` / `new_values`.   |
| `auditExcept` | `string[]` | Denylist — exclude these columns (applied when `auditOnly` is not set). |
| `auditType`   | `string`   | Override the `auditable_type` string (defaults to the class name).      |

The mixin also adds two instance methods, `auditLog()` and `auditLogs()`, covered
in [Manual audit events](#manual-audit-events) and
[Querying audit logs](#querying-audit-logs).

### Programmatic registration

For a model you'd rather not wrap in the mixin, register it from a provider's
`onBooted()` (after the container has resolved the `"audit"` binding). Configure it
with the same static fields:

```ts fragment
// in a ServiceProvider.onBooted()
import { registerAudit } from "@zerotal/audit";

registerAudit(User);
```

> **Which should I use?** Reach for the `Auditable` mixin by default — it also
> gives you the `auditLog()` / `auditLogs()` helpers. Use `registerAudit()` only
> when you cannot change a model's class hierarchy (e.g. a model from another
> package).

Both routes attach the same `AuditObserver`, which is what actually watches the
model's lifecycle. An update is recorded in two phases, and the reason is worth
knowing if you ever hook the same events yourself: the previous values only exist
until the ORM refreshes its snapshot, so the observer captures them during
`saving` and pairs them with the current values in `updated`. That is why an audit
row shows a real before _and_ after rather than the same values twice.

`AuditObserver` is exported for the rare case of composing it into an observer of
your own; using the mixin or `registerAudit()` is the supported path.

## Manual audit events

Log any custom event — logins, exports, settings changes — via the `Audit` facade.
Pass the **model instance** the event concerns; `auditable_type` and `auditable_id`
are derived from it, so logs are always linked to a record:

```ts fragment
function log(event: AuditEvent, model: Model, payload?: InstanceAuditPayload): Promise<void>;
function log(event: AuditEvent, payload: Omit<AuditPayload, "event">): Promise<void>;
```

```ts fragment
// in a controller or service (within a request context)
import { Audit } from "@zerotal/audit";

await Audit.log("login.success", user, {
  tags: { method: "github_oauth" },
});

await Audit.log("report.exported", report, {
  tags: { format: "csv", rows: 5000 },
});
```

For an event not tied to a model, pass a raw payload with `auditable_type`. Outside
a request (queue job, CLI command) supply the actor explicitly:

```ts fragment
// in a queue job or CLI command
await Audit.log("subscription.renewed", {
  auditable_type: "Subscription",
  auditable_id: sub.id,
  actor_type: "user",
  actor_id: sub.userId,
});
```

When a model is `Auditable`, the same call is available as an instance method:

```ts fragment
// in a controller or service
await user.auditLog("login.success", { tags: { method: "github_oauth" } });
```

The facade reads the authenticated user and request details (IP, user-agent, URL)
automatically from the active request context. You only need to supply them when
operating outside a request.

> **Warning** — Audit failures never crash the application; a failed write is
> logged to the console and swallowed. Treat the audit log as best-effort, not as a
> transactional guarantee.

## Querying audit logs

`AuditLog` is a full `Model` with scopes and chainable queries:

```ts fragment
// in a controller or service
import { AuditLog } from "@zerotal/audit";

// Last 25 events for a specific model instance
const history = await AuditLog.query()
  .where("auditable_type", "User")
  .where("auditable_id", String(user.id))
  .orderBy("id", "desc")
  .limit(25)
  .get();

// Built-in scopes return a chainable query builder
const userHistory = await AuditLog.forModel("User", user.id).get();
const actorLog = await AuditLog.byActor(user.id).get();
const loginEvents = await AuditLog.ofEvent("login.success").get();

// Paginate
const page = await AuditLog.query()
  .where("actor_id", user.id)
  .orderBy("id", "desc")
  .paginate(20, 1);
```

The `Audit` facade exposes the same queries plus a convenience read:

```ts fragment
// in a controller or service
const logs = await Audit.logs(User, user.id).orderBy("id", "desc").limit(25).get();
const byActor = await Audit.logsByActor(user.id).get();
const events = await Audit.logsOfEvent("login.success").get();

// Eager array of recent records for a model
const recent = await Audit.historyFor("User", user.id, 25);
```

An `Auditable` model also offers an instance shortcut:

```ts fragment
// in a controller or service
const logs = await user.auditLogs().orderBy("id", "desc").limit(25).get();
```

### Inspecting a record

```ts fragment
// in a controller or service
const entry = history[0];

entry.event; // "updated"
entry.auditableType; // "User"
entry.auditableId; // "42"
entry.actorId; // 7
entry.oldValues; // { email: "old@example.com" }
entry.newValues; // { email: "new@example.com" }
entry.ipAddress; // "203.0.113.1"
entry.url; // "http://localhost:3000/profile"

entry.changedKeys; // ["email"]
```

## What gets recorded

| Event     | `old_values`            | `new_values`           |
| --------- | ----------------------- | ---------------------- |
| `created` | _(empty)_               | full snapshot          |
| `updated` | changed fields (before) | changed fields (after) |
| `deleted` | full snapshot           | _(empty)_              |
| custom    | whatever you pass       | whatever you pass      |

For `updated`, only the diff is stored — unchanged fields are not included.
Snapshots use the model's `toJSON()`, so columns marked `hidden` are excluded
automatically.

## Drivers

| Driver     | Class            | Description                                           |
| ---------- | ---------------- | ----------------------------------------------------- |
| `database` | `DatabaseDriver` | Stores to `audit_logs` using `@zerotal/orm`. Default. |
| `null`     | `NullDriver`     | Discards all entries. Useful in tests.                |

Both classes are exported, so a custom driver can wrap one rather than
reimplementing it — decorating `DatabaseDriver` to also ship entries to a SIEM,
for instance.

Switch the driver in config:

```ts
// config/audit.ts
import { AuditConfig } from "@zerotal/audit";

export default AuditConfig({ driver: "null" }); // suppress auditing
```

Or swap it entirely in a `ServiceProvider` by binding a custom `AuditDriver`
implementation to the `"audit"` singleton.

## Testing

In tests, swap to the `NullDriver` so no database is needed. Bind a fresh
`Auditor` over the `"audit"` key:

```ts fragment
// tests/setup.ts
import { Application } from "zerotal";
import { Auditor, NullDriver } from "@zerotal/audit";

// Bind a fresh NullDriver so tests don't write to a DB
app.container.singleton(
  "audit",
  () => new Auditor(new NullDriver(), { driver: "null", captureRequest: false }),
);
```

## Security notes

> **Danger** — Never audit columns containing credentials. Exclude `password`,
> `rememberToken`, API tokens, etc. via `auditExcept`.

> **Warning** — `audit_logs` is append-only by design. The `AuditLog` model
> disables timestamps; do not add `updated_at` or allow row updates.

> **Note** — Grant read access to `audit_logs` only to admin roles.

## References

`Audit` facade — resolves the `Auditor` bound at `"audit"`:

| Method        | Signature                                                                         | Description                                             |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `log`         | `(event, model, payload?) => Promise<void>` · `(event, payload) => Promise<void>` | Record a manual event from a model instance or payload. |
| `historyFor`  | `(type: string, id: string \| number, limit?: number) => Promise<AuditRecord[]>`  | Eager array of recent records for a model.              |
| `logs`        | `(model: AuditableRef, id: string \| number) => ModelQueryBuilder<AuditLog>`      | Chainable query of one model's audit history.           |
| `logsByActor` | `(actorId: number) => ModelQueryBuilder<AuditLog>`                                | Chainable query of every log by an actor.               |
| `logsOfEvent` | `(event: AuditEvent) => ModelQueryBuilder<AuditLog>`                              | Chainable query of every log for an event name.         |

`AuditLog` model — scopes and helpers:

| Member        | Signature                                                             | Description                            |
| ------------- | --------------------------------------------------------------------- | -------------------------------------- |
| `forModel`    | `(type: string, id: string \| number) => ModelQueryBuilder<AuditLog>` | Scope to one model instance's history. |
| `byActor`     | `(actorId: number) => ModelQueryBuilder<AuditLog>`                    | Scope to a single actor.               |
| `ofEvent`     | `(event: AuditEvent) => ModelQueryBuilder<AuditLog>`                  | Scope to a single event name.          |
| `changedKeys` | `string[]`                                                            | Getter — keys present in `newValues`.  |

`Auditable(Base)` instance methods:

| Method      | Signature                                                              | Description                                 |
| ----------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| `auditLog`  | `(event: AuditEvent, payload?: InstanceAuditPayload) => Promise<void>` | Log a custom event against this instance.   |
| `auditLogs` | `() => ModelQueryBuilder<AuditLog>`                                    | Chainable query of this instance's history. |

## Types

`AuditableOptions` is what `Model.using(Auditable)` accepts — which columns are tracked and
which are ignored. `AuditConfigShape` is the `audit` config namespace.

## Next steps

- [ORM Lifecycle](/docs/orm/lifecycle) — the model hooks the audit system listens to.
- [Authentication](/docs/authentication) — how the actor on each entry is resolved.
- [Authorization](/docs/authorization) — gate read access to audit logs by role.
- [Testing](/docs/testing) — swap in the null driver for isolated tests.
