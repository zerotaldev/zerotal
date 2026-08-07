---
title: Client File Transfers
description: Uploading and downloading binary payloads.
---

# File uploads & downloads

The client encodes plain objects as JSON, which is the right default until the
payload is binary. Recognising the difference is the whole of file handling here:
on the way out, a body the platform already knows how to encode is passed through
untouched; on the way back, you name the shape you expect.

## Uploading

A body that is `FormData`, `Blob`, `File`, `URLSearchParams`, `ArrayBuffer`, or a
string is sent as-is with no JSON encoding, which lets `fetch` set the correct
`Content-Type` — including the multipart boundary, a value that cannot be written
by hand:

```ts
// in any frontend module
const form = new FormData();
form.append("avatar", file);
await api.post("/api/avatars", form);
```

| Body              | Sent as                                     |
| ----------------- | ------------------------------------------- |
| Plain object      | JSON, with `Content-Type: application/json` |
| `FormData`        | Multipart, boundary set by the platform     |
| `File` / `Blob`   | Raw bytes                                   |
| `URLSearchParams` | Form-encoded                                |
| `ArrayBuffer`     | Raw bytes                                   |
| String            | Sent verbatim                               |

Do not set `Content-Type` yourself for a `FormData` upload. A hand-written header
has no boundary parameter, and the server then fails to parse a body that is
otherwise perfectly formed — a confusing failure worth avoiding by simply leaving
the header alone.

To send a file alongside ordinary fields, put everything in the `FormData`;
mixing a JSON body and a file in one request is not possible:

```ts
const form = new FormData();
form.append("title", "Quarterly report");
form.append("document", file);
await api.post("/api/reports", form);
```

## Downloading

Responses are parsed as JSON unless you say otherwise. `responseType` names the
shape you want:

| `responseType`  | Returns              | Reach for it when                    |
| --------------- | -------------------- | ------------------------------------ |
| `"auto"`        | Parsed JSON, or text | The default — JSON with a safety net |
| `"json"`        | Parsed JSON, or text | The body is known to be JSON         |
| `"text"`        | `string`             | CSV, XML, plain text                 |
| `"blob"`        | `Blob`               | Saving or displaying a file          |
| `"arrayBuffer"` | `ArrayBuffer`        | Reading bytes directly               |

```ts
// in any frontend module
const pdf = await api.get("/api/report", undefined, { responseType: "blob" });
```

`"auto"` and `"json"` fall back to the raw text when the body will not parse, so a
misconfigured endpoint returning an HTML error page surfaces that page rather than
a parse exception.

A `204 No Content` response — or any response with `Content-Length: 0` — resolves
to `undefined` rather than throwing, so a `DELETE` needs no special handling:

```ts
await api.delete("/api/avatars/1"); // → undefined
```

Handing a downloaded blob to the browser takes one more step, since the client
returns the data rather than saving it:

```ts
const blob = await api.get("/api/report", undefined, { responseType: "blob" });

const url = URL.createObjectURL(blob);
const a = Object.assign(document.createElement("a"), { href: url, download: "report.pdf" });
a.click();
URL.revokeObjectURL(url);
```

## Reading response metadata

Binary endpoints often carry the interesting information in headers. A per-request
`meta` callback reads them without installing a global interceptor:

```ts
// in any frontend module
let total: string | null = null;
const users = await api.get("/api/users", undefined, {
  meta: (m) => (total = m.headers.get("X-Total")),
});
```

This is the way to reach pagination totals, rate-limit counters, and `ETag` values
while still receiving the parsed body as the return value.

## Query serialization

Query objects serialize arrays and nested objects with bracket notation:
`{ ids: [1, 2], filter: { status: "open" } }` becomes
`?ids[]=1&ids[]=2&filter[status]=open`.

## Next steps

- [Client overview](/docs/client) — the guide's front page and the rest of the sections.
- [Making requests](/docs/client/requests) — the full request surface.
- [Error handling](/docs/client/errors) — what a failed transfer throws.
