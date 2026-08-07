---
title: Client Requests
description: The typed route map, making requests, and shaping them with interceptors.
---

# Route map

Define your API surface once. Keys are `'METHOD /path'` strings — path params are
`{braces}` style. All fields are optional.

```ts
// app/api/api-types.ts
export interface Routes {
  "GET /api/users": {
    query: { page?: number; perPage?: number; search?: string };
    response: { data: UserResource[]; total: number };
  };
  "GET /api/users/{id}": {
    params: { id: number };
    response: UserResource;
  };
  "POST /api/users": {
    body: { name: string; email: string; password: string };
    response: UserResource;
  };
  "PUT /api/users/{id}": {
    params: { id: number };
    body: { name?: string; email?: string };
    response: UserResource;
  };
  "DELETE /api/users/{id}": {
    params: { id: number };
    response: void;
  };
}
```

## Making requests

```ts
// in any frontend module
// GET with path params
const user = await api.get("/api/users/{id}", { id: 42 });
//    ^? UserResource — inferred from the route map

// GET with query string
const list = await api.get("/api/users", undefined, {
  query: { page: 2, perPage: 25, search: "alice" },
});
//    ^? { data: UserResource[]; total: number }

// POST with body
const created = await api.post("/api/users", {
  name: "Alice",
  email: "alice@example.com",
  password: "hunter2",
});
//    ^? UserResource

// PUT
await api.put("/api/users/{id}", { name: "Alice Smith" }, { params: { id: 42 } });

// PATCH
await api.patch("/api/users/{id}", { email: "new@example.com" }, { params: { id: 42 } });

// DELETE
await api.delete("/api/users/{id}", { id: 42 });
```

All methods accept an optional `options` argument for per-request headers and
extra `fetch` init fields (`signal`, `credentials`, etc.):

```ts
// in any frontend module
const ctrl = new AbortController();

await api.get("/api/users", undefined, {
  headers: { "X-Trace-Id": requestId },
  init: { signal: ctrl.signal },
});
```

## Request interceptors

Run one or more async functions before every outgoing request. Each interceptor
receives the current `RequestConfig` and must return it (or a new one). Useful for
attaching authorization headers from a reactive store without coupling the store
to the client's constructor.

```ts
// app/api/client.ts
const api = createApiClient<Routes>({
  baseUrl: "https://api.example.com",

  // Single interceptor
  onRequest: async (config) => ({
    ...config,
    headers: {
      ...config.headers,
      Authorization: `Bearer ${await tokenStore.get()}`,
    },
  }),
});
```

Multiple interceptors execute in declaration order:

```ts
// app/api/client.ts
const api = createApiClient<Routes>({
  baseUrl: "https://api.example.com",
  onRequest: [addAuthHeader, addRequestId, logOutgoing],
});
```

A symmetric `onResponse` runs after every successful (2xx) response — receiving a
`ResponseContext` of `{ status, headers, data, request }` — to unwrap envelopes or log.

### RequestConfig shape

| Field     | Type                     | Description                                                  |
| --------- | ------------------------ | ------------------------------------------------------------ |
| `method`  | `string`                 | HTTP verb — `'GET'`, `'POST'`, …                             |
| `url`     | `string`                 | Full resolved URL (base + path + query string)               |
| `headers` | `Record<string, string>` | Merged headers — add/override here                           |
| `body`    | `BodyInit \| undefined`  | Serialised body (JSON string, `FormData`, …), or `undefined` |

## Next steps

- [Client overview](/docs/client) — the guide's front page and the rest of the sections.
- [Reference](/docs/client/references) — the full API surface in one table.
