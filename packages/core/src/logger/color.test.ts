import { describe, it, expect } from "bun:test";
import { _colorEnabled, _colorEnv, _stripColor } from "./color.ts";

const tty = { isTTY: true };
const pipe = { isTTY: false };

describe("_colorEnabled()", () => {
  it("colours a terminal and not a pipe", () => {
    expect(_colorEnabled(tty, {})).toBe(true);
    expect(_colorEnabled(pipe, {})).toBe(false);
  });

  it("honours NO_COLOR over everything, and FORCE_COLOR over a pipe", () => {
    expect(_colorEnabled(tty, { NO_COLOR: "1" })).toBe(false);
    expect(_colorEnabled(tty, { NO_COLOR: "1", FORCE_COLOR: "1" })).toBe(false);
    expect(_colorEnabled(pipe, { FORCE_COLOR: "1" })).toBe(true);
    expect(_colorEnabled(tty, { FORCE_COLOR: "0" })).toBe(false);
    // An empty NO_COLOR is unset, as the convention says.
    expect(_colorEnabled(tty, { NO_COLOR: "" })).toBe(true);
  });
});

describe("_stripColor()", () => {
  it("removes colour codes and nothing else", () => {
    expect(_stripColor("\x1b[2m05:20\x1b[0m \x1b[32mINFO \x1b[0m ok")).toBe("05:20 INFO  ok");
  });
});

describe("_colorEnv()", () => {
  it("tells a piped child to keep its colours when this process shows colour", () => {
    expect(_colorEnv({ PATH: "/bin" }, tty)["FORCE_COLOR"]).toBe("1");
  });

  it("passes NO_COLOR, or a pipe of its own, on unchanged", () => {
    expect(_colorEnv({ NO_COLOR: "1" }, tty)["FORCE_COLOR"]).toBeUndefined();
    expect(_colorEnv({}, pipe)["FORCE_COLOR"]).toBeUndefined();
  });
});
