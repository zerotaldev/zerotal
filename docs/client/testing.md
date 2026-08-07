---
title: Testing the Client
description: Stub the global fetch, cover the failure paths, and drive the circuit breaker.
---

# Testing

Set your suite up once as described in [Testing](/docs/testing). `ApiClient`
calls the global `fetch`, so a test controls it by replacing that — there is no
separate fake to install.

```typescript
// tests/services/BillingClient.test.ts
import { test, expect, afterEach } from "bun:test";
import { ApiClient } from "@zerotal/client";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("maps a customer payload onto our shape", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ id: "cus_1", email: "jane@example.com" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const client = new ApiClient({ baseUrl: "https://api.example.com" });
  const customer = await client.get("/customers/cus_1");

  expect(customer.email).toBe("jane@example.com");
});
```

**Restore `fetch` in `afterEach`, not at the end of the test.** A test that
throws before its cleanup line leaves the stub installed, and every later test in
the file talks to it instead of the network — producing failures that point at
innocent code.

## Asserting on the request

Stubbing the response proves your code reads the answer correctly. It says nothing
about whether you asked the right question — a client that sends the wrong URL,
loses a query parameter, or drops the auth header passes every response-shaped test
and still fails in production. Capture what `fetch` received and assert on it:

```typescript
// tests/services/BillingClient.test.ts
test("sends the query and the auth header", async () => {
  let url: string | undefined;
  let init: RequestInit | undefined;

  globalThis.fetch = async (u, i) => {
    url = String(u);
    init = i;
    return new Response("[]", { status: 200 });
  };

  const client = new ApiClient({
    baseUrl: "https://api.example.com",
    token: "tok_123",
  });
  await client.get("/customers", { status: "active" });

  expect(url).toBe("https://api.example.com/customers?status=active");
  expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok_123");
});
```

Wrap the headers in `new Headers(...)` before reading them. Casing is normalised
that way, so the assertion holds whether the value arrived as a plain object or as
a `Headers` instance from a per-request override.

Uploads deserve one such test each. Asserting that `init.body` is the `FormData`
you passed — rather than a JSON string — is what pins down that the body was not
re-encoded on its way out.

**Test the failure paths, because they are the ones production hits.** A 500, a
timeout, and a malformed body all reach your code differently:

```typescript
// tests/services/BillingClient.test.ts
test("a 500 surfaces as ApiClientError", async () => {
  globalThis.fetch = async () => new Response("upstream boom", { status: 500 });

  await expect(client.get("/customers/cus_1")).rejects.toBeInstanceOf(ApiClientError);
});
```

A network failure is a different case again, and the stub models it by rejecting
instead of resolving — which is how you reach the branch that never receives a
status at all:

```typescript
globalThis.fetch = async () => {
  throw new TypeError("Failed to fetch");
};

await expect(client.get("/customers")).rejects.not.toBeInstanceOf(ApiClientError);
```

## Retries and the circuit breaker

A retry policy is invisible from the outside — the caller sees one resolved promise
whether it took one attempt or four. Counting calls is what makes the behaviour
observable:

```typescript
// tests/services/BillingClient.test.ts
let calls = 0;
globalThis.fetch = async () => {
  calls++;
  return calls < 3 ? new Response("", { status: 503 }) : new Response("{}", { status: 200 });
};

await client.get("/customers");
expect(calls).toBe(3); // two failures, then success
```

**A circuit breaker is a state machine**, so drive it with repeated failures and
assert it opens — then that it refuses without calling `fetch` at all:

```typescript
// tests/services/BillingClient.test.ts
let calls = 0;
globalThis.fetch = async () => {
  calls++;
  return new Response("", { status: 500 });
};

for (let i = 0; i < threshold; i++) await client.get("/x").catch(() => {});
const before = calls;

await expect(client.get("/x")).rejects.toBeInstanceOf(CircuitBreakerOpenError);
expect(calls).toBe(before); // the open circuit short-circuits, no request made
```

That last assertion is the point of a breaker — without it you have tested that
an error is thrown, not that the upstream was spared.

## Next steps

- [Client overview](/docs/client) — the guide's front page and the rest of the sections.
- [Resilience](/docs/client/resilience) — the retry and breaker policies under test.
- [Error handling](/docs/client/errors) — the errors these tests assert on.
