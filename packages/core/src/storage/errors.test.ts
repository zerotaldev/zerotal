import { describe, it, expect } from "bun:test";
import { ZerotalError } from "../errors/ZerotalError.ts";
import { StorageManager } from "./StorageManager.ts";
import { StorageError, DiskNotConfiguredError } from "./errors.ts";
import type { StorageConfigShape } from "./types.ts";

describe("storage errors", () => {
  it("disk() throws DiskNotConfiguredError for an unknown disk", () => {
    const sm = new StorageManager({ default: "local", disks: {} } as unknown as StorageConfigShape);
    expect(() => sm.disk("nope")).toThrow(DiskNotConfiguredError);
  });
  it("DiskNotConfiguredError carries code/status and extends the base", () => {
    const e = new DiskNotConfiguredError("reports");
    expect(e).toBeInstanceOf(StorageError);
    expect(e).toBeInstanceOf(ZerotalError);
    expect(e.code).toBe("E_STORAGE_DISK_NOT_CONFIGURED");
    expect(e.status).toBe(500);
    expect(e.context).toEqual({ disk: "reports" });
  });
});
