/**
 * A `validate` check that throws refuses the value, the way one that returns a reason does.
 *
 * A check is written for the declared shape, but a value from a form reaches it before
 * anything else has looked at its shape: `setFromText()` on a JSON setting parses `"null"`
 * to `null`, and the check the docs show, `(v) => (Array.isArray(v.days) ? … : …)`, then
 * throws a TypeError. That escaped as a 500 from the settings screen instead of the
 * `InvalidSettingValueError` (422) every other refused value gives.
 */
import { describe, it, expect } from "bun:test";
import { defineSettings } from "./defineSettings.ts";
import { setting } from "./setting.ts";
import { SettingsManager } from "./SettingsManager.ts";
import { MemoryStore } from "./stores/MemoryStore.ts";
import { InvalidSettingValueError } from "./errors.ts";

// The check as docs/settings.md writes it: not guarded against a value of another shape.
const schedule = () =>
  setting.json<{ days: number[] }>({
    default: { days: [7, 14] },
    validate: (v) => (Array.isArray(v.days) ? undefined : "needs a list of days"),
  });

defineSettings({ "validateRefusal.schedule": schedule() });

describe("a validate check that throws", () => {
  it("refuses the value with InvalidSettingValueError", () => {
    const definition = schedule();
    expect(() => definition.parse("null", "validateRefusal.schedule", true)).toThrow(
      InvalidSettingValueError,
    );
  });

  it("names the setting and keeps the check's own message as the reason", () => {
    let caught: unknown;
    try {
      schedule().parse(null, "validateRefusal.schedule");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidSettingValueError);
    const error = caught as InvalidSettingValueError;
    expect(error.status).toBe(422);
    expect(error.message).toContain('"validateRefusal.schedule"');
    expect(error.context?.["reason"]).toEqual(expect.stringContaining("days"));
  });

  it("makes setFromText refuse JSON null rather than fail, and stores nothing", async () => {
    const store = new MemoryStore();
    const settings = new SettingsManager(store, { audit: false });

    await expect(settings.setFromText("validateRefusal.schedule", "null")).rejects.toBeInstanceOf(
      InvalidSettingValueError,
    );
    expect(await settings.get("validateRefusal.schedule")).toEqual({ days: [7, 14] });
  });

  it("still lets a returned reason and a passing value through unchanged", async () => {
    const settings = new SettingsManager(new MemoryStore(), { audit: false });

    await expect(settings.setFromText("validateRefusal.schedule", '{"days":"x"}')).rejects.toThrow(
      "needs a list of days",
    );
    await settings.setFromText("validateRefusal.schedule", '{"days":[1,3]}');
    expect(await settings.get("validateRefusal.schedule")).toEqual({ days: [1, 3] });
  });
});
