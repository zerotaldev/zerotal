import { describe, it, expect, beforeEach } from "bun:test";
import {
  exportAction,
  bulkExportAction,
  importAction,
  importCsv,
  IMPORT_ROW_LIMIT,
} from "./transfer.ts";
import { toCsv } from "./csv.ts";
import type { ActionContext, ActionPage } from "./Action.ts";
import { Resource } from "../Resource.ts";
import type { ResourceClass, ListOptions } from "../Resource.ts";
import { text } from "../table/Column.ts";
import { textInput } from "../form/index.ts";

/** An in-memory resource: enough surface for the transfer actions to work on. */
let store: Record<string, unknown>[] = [];
let nextId = 1;

class ContactResource extends Resource {
  static override model = { name: "Contact" };

  static override columns() {
    return [
      text("id"),
      text("name"),
      text("email"),
      // Never exported: the point of the flag.
      text("secret").exportable(false),
    ];
  }

  static override form() {
    return [textInput("name").required(), textInput("email").email().required()];
  }

  static override can(): boolean {
    return true;
  }

  static override async listAll(_options: ListOptions = {}): Promise<Record<string, unknown>[]> {
    return store;
  }

  static override async find(id: unknown): Promise<Record<string, unknown> | null> {
    return store.find((r) => String(r["id"]) === String(id)) ?? null;
  }

  static override async create(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const record = { id: nextId++, ...data };
    store.push(record);
    return record;
  }
}

interface Captured {
  downloads: { filename: string; content: string }[];
  flashes: { message: string; level?: string }[];
}

function pageDouble(captured: Captured): ActionPage {
  return {
    flash: (message, level) => captured.flashes.push({ message, level }),
    redirect: () => ({ withSuccess: () => undefined }),
    download: (filename, content) => captured.downloads.push({ filename, content }),
  };
}

function ctxFor(captured: Captured, extra: Partial<ActionContext> = {}): ActionContext {
  return {
    resource: ContactResource as unknown as ResourceClass,
    page: pageDouble(captured),
    base: "/admin",
    slug: "contacts",
    ...extra,
  } as ActionContext;
}

const fresh = (): Captured => ({ downloads: [], flashes: [] });

beforeEach(() => {
  store = [];
  nextId = 1;
});

describe("exportAction", () => {
  it("delivers the current list as a dated CSV", async () => {
    store = [
      { id: 1, name: "Ada", email: "ada@example.com", secret: "hunter2" },
      { id: 2, name: "Grace", email: "grace@example.com", secret: "hunter2" },
    ];
    const captured = fresh();
    await exportAction().execute(ctxFor(captured));

    expect(captured.downloads).toHaveLength(1);
    expect(captured.downloads[0]!.filename).toMatch(/^contacts-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = captured.downloads[0]!.content.split("\r\n");
    expect(lines[0]).toBe("Id,Name,Email");
    expect(lines[1]).toBe("1,Ada,ada@example.com");
  });

  it("leaves out a column marked unexportable", async () => {
    store = [{ id: 1, name: "Ada", email: "a@e.com", secret: "hunter2" }];
    const captured = fresh();
    await exportAction().execute(ctxFor(captured));
    expect(captured.downloads[0]!.content).not.toContain("hunter2");
    expect(captured.downloads[0]!.content).not.toContain("Secret");
  });

  it("says so rather than sending an empty file", async () => {
    const captured = fresh();
    await exportAction().execute(ctxFor(captured));
    expect(captured.downloads).toHaveLength(0);
    expect(captured.flashes[0]!.message).toBe("Nothing to export.");
  });
});

describe("bulkExportAction", () => {
  it("exports only the selected rows, resolving them from their ids", async () => {
    store = [
      { id: 1, name: "Ada", email: "ada@example.com" },
      { id: 2, name: "Grace", email: "grace@example.com" },
      { id: 3, name: "Alan", email: "alan@example.com" },
    ];
    const captured = fresh();
    await bulkExportAction().execute(ctxFor(captured, { ids: ["1", "3"] }));

    const content = captured.downloads[0]!.content;
    expect(content).toContain("Ada");
    expect(content).toContain("Alan");
    expect(content).not.toContain("Grace");
  });
});

describe("importCsv", () => {
  it("creates a record per data row", async () => {
    const result = await importCsv(
      ContactResource as unknown as ResourceClass,
      "Name,Email\nAda,ada@example.com\nGrace,grace@example.com",
    );
    expect(result).toEqual({ created: 2, failures: [] });
    expect(store.map((r) => r["name"])).toEqual(["Ada", "Grace"]);
  });

  it("matches headers to fields regardless of case and separators", async () => {
    const result = await importCsv(
      ContactResource as unknown as ResourceClass,
      "  name ,E-Mail\nAda,ada@example.com",
    );
    // "  name " has surrounding spaces; "E-Mail" differs in case and separator.
    expect(result.created).toBe(1);
    expect(store[0]).toMatchObject({ name: "Ada", email: "ada@example.com" });
  });

  it("skips a row missing a required field and keeps going", async () => {
    const result = await importCsv(
      ContactResource as unknown as ResourceClass,
      "Name,Email\nAda,ada@example.com\n,orphan@example.com\nGrace,grace@example.com",
    );
    expect(result.created).toBe(2);
    expect(result.failures).toEqual(["Row 3: missing Name."]);
  });

  it("ignores a blank trailing row", async () => {
    const result = await importCsv(
      ContactResource as unknown as ResourceClass,
      "Name,Email\nAda,ada@example.com\n,\n",
    );
    expect(result).toEqual({ created: 1, failures: [] });
  });

  it("refuses a file with no data rows", async () => {
    const result = await importCsv(ContactResource as unknown as ResourceClass, "Name,Email");
    expect(result.created).toBe(0);
    expect(result.failures[0]).toBe("The file has no data rows.");
  });

  it("refuses a file whose columns match nothing", async () => {
    const result = await importCsv(ContactResource as unknown as ResourceClass, "alpha,beta\n1,2");
    expect(result.created).toBe(0);
    expect(result.failures[0]).toContain("No column in the file matches");
  });

  it("refuses a file past the row limit rather than half-importing it", async () => {
    const rows = Array.from(
      { length: IMPORT_ROW_LIMIT + 1 },
      (_, i) => `Name ${i},n${i}@example.com`,
    );
    const result = await importCsv(
      ContactResource as unknown as ResourceClass,
      ["Name,Email", ...rows].join("\n"),
    );
    expect(result.created).toBe(0);
    expect(store).toHaveLength(0);
    expect(result.failures[0]).toContain(String(IMPORT_ROW_LIMIT));
  });
});

describe("export → import round trip", () => {
  it("returns the same values it wrote out", async () => {
    store = [
      { id: 1, name: 'Ada, "the" first', email: "ada@example.com" },
      { id: 2, name: "Grace\nHopper", email: "grace@example.com" },
    ];
    const captured = fresh();
    await exportAction().execute(ctxFor(captured));
    const csv = captured.downloads[0]!.content;

    // Re-import into an empty store and compare what came back.
    const original = store;
    store = [];
    const result = await importCsv(ContactResource as unknown as ResourceClass, csv);

    expect(result.failures).toEqual([]);
    expect(result.created).toBe(original.length);
    expect(store.map((r) => ({ name: r["name"], email: r["email"] }))).toEqual(
      original.map((r) => ({ name: r["name"], email: r["email"] })),
    );
  });
});

describe("importAction", () => {
  it("asks for a file when the modal was submitted empty", async () => {
    const captured = fresh();
    await importAction().execute(ctxFor(captured, { data: { file: "  " } }));
    expect(captured.flashes[0]!.message).toBe("Choose a CSV file to import.");
    expect(store).toHaveLength(0);
  });

  it("reports what landed and what was skipped", async () => {
    const captured = fresh();
    await importAction().execute(
      ctxFor(captured, { data: { file: "Name,Email\nAda,ada@example.com\n,x@e.com" } }),
    );
    expect(store).toHaveLength(1);
    expect(captured.flashes[0]!.message).toContain("Imported 1 contact");
    expect(captured.flashes[0]!.message).toContain("1 skipped");
    expect(captured.flashes[0]!.level).toBe("warning");
  });

  it("takes a CSV file through the modal's file field", async () => {
    const csv = toCsv([{ name: "Ada", email: "ada@example.com" }], [text("name"), text("email")]);
    const captured = fresh();
    await importAction().execute(ctxFor(captured, { data: { file: csv } }));
    expect(store).toHaveLength(1);
    expect(captured.flashes[0]!.message).toBe("Imported 1 contact.");
  });
});
