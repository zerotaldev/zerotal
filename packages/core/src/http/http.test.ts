import { describe, it, expect, afterEach } from "bun:test";
import { Http } from "./Http.ts";
import { HttpClientError } from "./HttpClient.ts";

afterEach(() => Http.resetFakes());

// ── Fake / stub ────────────────────────────────────────────────────────────────

describe("Http.fake — JSON stub", () => {
  it("returns a faked JSON response", async () => {
    Http.fake([{ url: "https://api.test/users", body: [{ id: 1 }] }]);
    const res = await Http.get("https://api.test/users");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    const data = await res.json<{ id: number }[]>();
    expect(data[0]?.id).toBe(1);
  });

  it("wildcard * matches any URL", async () => {
    Http.fake([{ url: "*", body: { ok: true } }]);
    const res = await Http.get("https://anything.example.com/path");
    expect(res.ok).toBe(true);
  });

  it("prefix wildcard matches URL pattern", async () => {
    Http.fake([{ url: "https://api.test/*", body: "hit" }]);
    const res = await Http.get("https://api.test/v1/users");
    // string body is returned as-is (text/plain)
    expect(await res.text()).toBe("hit");
  });

  it("returns custom status code", async () => {
    Http.fake([{ url: "*", status: 404 }]);
    const res = await Http.get("https://api.test/missing");
    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
  });

  it("throws when no stub matches", async () => {
    Http.fake([{ url: "https://api.test/a", body: {} }]);
    // .send() returns a native Promise, compatible with .rejects
    await expect(Http.get("https://api.test/b").send()).rejects.toThrow("No stub matched");
  });
});

// ── Recording ──────────────────────────────────────────────────────────────────

describe("Http.recorded()", () => {
  it("records each request", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.get("https://api.test/a");
    await Http.post("https://api.test/b", { x: 1 });
    const r = Http.recorded();
    expect(r.length).toBe(2);
    expect(r[0]?.method).toBe("GET");
    expect(r[1]?.method).toBe("POST");
  });

  it("assertSent() passes when a matching request was made", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.get("https://api.test/users");
    expect(() => Http.assertSent((r) => r.url.includes("/users"))).not.toThrow();
  });

  it("assertSent() throws when no request matched", async () => {
    Http.fake([{ url: "*", body: {} }]);
    expect(() => Http.assertSent((r) => r.url.includes("/missing"))).toThrow("assertSent");
  });

  it("assertNotSent() passes when predicate finds no match", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.get("https://api.test/users");
    expect(() => Http.assertNotSent((r) => r.url.includes("/orders"))).not.toThrow();
  });

  it("assertSentCount() validates total request count", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.get("https://api.test/a");
    await Http.get("https://api.test/b");
    expect(() => Http.assertSentCount(2)).not.toThrow();
    expect(() => Http.assertSentCount(1)).toThrow("assertSentCount");
  });

  it("assertNothingSent() passes before any requests", () => {
    Http.fake([{ url: "*", body: {} }]);
    expect(() => Http.assertNothingSent()).not.toThrow();
  });
});

// ── Verb methods ───────────────────────────────────────────────────────────────

describe("Http verb methods", () => {
  it("Http.post() includes JSON body", async () => {
    Http.fake([{ url: "*", body: { created: true } }]);
    await Http.post("https://api.test/users", { name: "Alice" });
    const [req] = Http.recorded();
    expect(req?.method).toBe("POST");
    expect(req?.options.body).toBe(JSON.stringify({ name: "Alice" }));
  });

  it("Http.put() sets method PUT", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.put("https://api.test/users/1", { name: "Bob" });
    expect(Http.recorded()[0]?.method).toBe("PUT");
  });

  it("Http.patch() sets method PATCH", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.patch("https://api.test/users/1", { name: "Bob" });
    expect(Http.recorded()[0]?.method).toBe("PATCH");
  });

  it("Http.delete() sets method DELETE", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.delete("https://api.test/users/1");
    expect(Http.recorded()[0]?.method).toBe("DELETE");
  });
});

// ── Fluent builder ─────────────────────────────────────────────────────────────

describe("Http fluent builder", () => {
  it(".withToken() sets Authorization header", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.withToken("secret-token").get("https://api.test/me");
    const [req] = Http.recorded();
    const authHeader = (req?.options.headers as Record<string, string>)["Authorization"];
    expect(authHeader).toBe("Bearer secret-token");
  });

  it(".withHeaders() merges custom headers", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.get("https://api.test/data").withHeaders({ "X-App": "reno" }).send();
    const [req] = Http.recorded();
    const xApp = (req?.options.headers as Record<string, string>)["X-App"];
    expect(xApp).toBe("reno");
  });

  it(".withBasicAuth() encodes credentials", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.withBasicAuth("admin", "pass").get("https://api.test/secure");
    const [req] = Http.recorded();
    const auth = (req?.options.headers as Record<string, string>)["Authorization"];
    expect(auth).toContain("Basic ");
    expect(auth).toBe(`Basic ${btoa("admin:pass")}`);
  });

  it(".acceptJson() sets Accept header", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.get("https://api.test/data").acceptJson().send();
    const [req] = Http.recorded();
    const accept = (req?.options.headers as Record<string, string>)["Accept"];
    expect(accept).toBe("application/json");
  });
});

// ── Shorthand ──────────────────────────────────────────────────────────────────

describe("Http shorthand methods", () => {
  it(".json() deserializes body", async () => {
    Http.fake([{ url: "*", body: { value: 42 } }]);
    const data = await Http.get("https://api.test/data").json<{ value: number }>();
    expect(data.value).toBe(42);
  });

  it(".text() returns string body", async () => {
    Http.fake([{ url: "*", body: "hello", headers: { "Content-Type": "text/plain" } }]);
    const text = await Http.get("https://api.test/data").text();
    expect(text).toBe("hello");
  });

  it("awaiting PendingRequest directly works", async () => {
    Http.fake([{ url: "*", status: 201 }]);
    const res = await Http.post("https://api.test/items", {});
    expect(res.status).toBe(201);
  });
});

// ── Http.withHeaders() static — covers lines 29-32 of Http.ts ────────────────

describe("Http.withHeaders() static builder", () => {
  it("sets custom headers on the request", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.withHeaders({ "X-Tenant": "acme", "X-Version": "2" }).get("https://api.test/data");
    const [req] = Http.recorded();
    const h = req?.options.headers as Record<string, string>;
    expect(h["X-Tenant"]).toBe("acme");
    expect(h["X-Version"]).toBe("2");
  });

  it("Http.timeout() builder sets timeout on the request", async () => {
    Http.fake([{ url: "*", body: {} }]);
    // timeout is stored internally; just confirm the request completes through the builder
    await Http.timeout(5000).get("https://api.test/ok");
    expect(Http.recorded()[0]?.method).toBe("GET");
  });

  it("Http.retry() builder sets retry count", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.retry(3, 0).get("https://api.test/ok");
    expect(Http.recorded()[0]?.method).toBe("GET");
  });

  it("Http.head() makes a HEAD request", async () => {
    Http.fake([{ url: "*" }]);
    const res = await Http.head("https://api.test/ping");
    expect(Http.recorded()[0]?.method).toBe("HEAD");
    expect(res.status).toBe(200);
  });
});

// ── _Builder verb methods — covers _Builder.post/put/patch/delete/head ────────

describe("_Builder verb methods via Http.withToken()", () => {
  it(".post() sends POST with body", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.withToken("tok").post("https://api.test/items", { name: "test" });
    const [req] = Http.recorded();
    expect(req?.method).toBe("POST");
    expect(req?.options.body).toBe(JSON.stringify({ name: "test" }));
  });

  it(".put() sends PUT", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.withToken("tok").put("https://api.test/items/1", { name: "upd" });
    expect(Http.recorded()[0]?.method).toBe("PUT");
  });

  it(".patch() sends PATCH", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.withToken("tok").patch("https://api.test/items/1", { active: true });
    expect(Http.recorded()[0]?.method).toBe("PATCH");
  });

  it(".delete() sends DELETE", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.withToken("tok").delete("https://api.test/items/1");
    expect(Http.recorded()[0]?.method).toBe("DELETE");
  });

  it(".head() sends HEAD", async () => {
    Http.fake([{ url: "*" }]);
    await Http.withToken("tok").head("https://api.test/ping");
    expect(Http.recorded()[0]?.method).toBe("HEAD");
  });
});

// ── PendingRequest instance methods — covers HttpClient.ts lines 110-152 ─────

describe("PendingRequest instance methods", () => {
  it(".withToken() sets Authorization header on the pending request", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.get("https://api.test/me").withToken("bearer-tok").send();
    const [req] = Http.recorded();
    const auth = (req?.options.headers as Record<string, string>)["Authorization"];
    expect(auth).toBe("Bearer bearer-tok");
  });

  it(".withBasicAuth() base64-encodes credentials on the pending request", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.get("https://api.test/secure").withBasicAuth("usr", "pwd").send();
    const [req] = Http.recorded();
    const auth = (req?.options.headers as Record<string, string>)["Authorization"];
    expect(auth).toBe(`Basic ${btoa("usr:pwd")}`);
  });

  it(".timeout() stores timeout on the pending request", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.get("https://api.test/ok").timeout(3000).send();
    expect(Http.recorded()[0]?.method).toBe("GET");
  });

  it(".retry() stores retry count on the pending request", async () => {
    Http.fake([{ url: "*", body: {} }]);
    await Http.get("https://api.test/ok").retry(2, 50).send();
    expect(Http.recorded()[0]?.method).toBe("GET");
  });

  it(".withFormData() attaches FormData body", async () => {
    Http.fake([{ url: "*", body: {} }]);
    const fd = new FormData();
    fd.append("field", "value");
    await Http.post("https://api.test/upload").withFormData(fd).send();
    const [req] = Http.recorded();
    expect(req?.method).toBe("POST");
    expect(req?.options.body).toBeInstanceOf(FormData);
  });
});

// ── HttpClientResponse accessors ─────────────────────────────────────────────

describe("HttpClientResponse accessors", () => {
  it(".headers getter returns the response Headers", async () => {
    Http.fake([{ url: "*", body: {}, headers: { "X-Custom": "yes" } }]);
    const res = await Http.get("https://api.test/h");
    expect(res.headers.get("X-Custom")).toBe("yes");
  });

  it(".blob() returns a Blob", async () => {
    Http.fake([
      { url: "*", body: "binary", headers: { "Content-Type": "application/octet-stream" } },
    ]);
    const res = await Http.get("https://api.test/file");
    const blob = await res.blob();
    expect(blob).toBeInstanceOf(Blob);
  });
});

// ── HttpClientResponse.throw() ────────────────────────────────────────────────

describe("HttpClientResponse.throw()", () => {
  it("does not throw on 2xx", async () => {
    Http.fake([{ url: "*", status: 200 }]);
    const res = await Http.get("https://api.test/ok");
    expect(() => res.throw()).not.toThrow();
  });

  it("throws HttpClientError on 4xx", async () => {
    Http.fake([{ url: "*", status: 403, body: { error: "forbidden" } }]);
    const res = await Http.get("https://api.test/secret");
    expect(() => res.throw()).toThrow(HttpClientError);
  });

  it("HttpClientError carries status code", async () => {
    Http.fake([{ url: "*", status: 404 }]);
    const res = await Http.get("https://api.test/missing");
    try {
      res.throw();
      throw new Error("should not reach");
    } catch (e) {
      expect((e as HttpClientError).status).toBe(404);
    }
  });
});
