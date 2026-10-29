import { describe, it, expect } from "bun:test";
import {
  assertMailAddress,
  resolveAddress,
  _assertPayloadAddresses,
  _formatMailbox,
} from "./MailDriver.ts";
import { InvalidMailAddressError, NotificationError } from "../errors.ts";

/** NEL and the Unicode line and paragraph separators: line breaks to some readers. */
const NEL = String.fromCharCode(0x85);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const UNICODE_BREAKS = [NEL, LINE_SEPARATOR, PARAGRAPH_SEPARATOR];

/** Decode RFC 2047 `B` encoded-words, written independently of the driver's encoder. */
function decodeWords(value: string): string {
  return value
    .split(" ")
    .map((word) => {
      const match = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=$/.exec(word);
      if (!match) throw new Error(`not an encoded-word: ${word}`);
      return match[1]!;
    })
    .map((base64) => Buffer.from(base64, "base64"))
    .reduce((all, part) => Buffer.concat([all, part]), Buffer.alloc(0))
    .toString("utf8");
}

describe("assertMailAddress", () => {
  it("accepts ordinary addresses", () => {
    for (const address of [
      "ada@example.com",
      "ada.lovelace+invoices@mail.example.co.za",
      "o'brien@example.com",
      // RFC 5321 quoted local part: a second @ is legal inside the quotes.
      '"ada@home"@example.com',
      // Internationalised addresses are the server's to accept or refuse.
      "jörg@exämple.de",
    ]) {
      expect(() => assertMailAddress(address)).not.toThrow();
    }
  });

  it("refuses CR and LF, together and each on its own", () => {
    for (const address of [
      "ada@example.com\r\nRSET",
      "ada@example.com\rRSET",
      "ada@example.com\nRSET",
    ]) {
      expect(() => assertMailAddress(address)).toThrow(InvalidMailAddressError);
    }
  });

  it("refuses every C0 control character and DEL", () => {
    const controls = [...Array.from({ length: 0x20 }, (_, i) => i), 0x7f];
    for (const code of controls) {
      const address = `ada${String.fromCharCode(code)}@example.com`;
      expect(() => assertMailAddress(address)).toThrow(InvalidMailAddressError);
    }
  });

  it("refuses NEL and the Unicode line and paragraph separators", () => {
    for (const separator of UNICODE_BREAKS) {
      expect(() => assertMailAddress(`ada@example.com${separator}RSET`)).toThrow(
        InvalidMailAddressError,
      );
    }
  });

  it("refuses whitespace, including non-ASCII spaces", () => {
    for (const address of [
      "ada @example.com",
      " ada@example.com",
      "ada@example.com ",
      "ada @example.com",
      "ada @example.com",
    ]) {
      expect(() => assertMailAddress(address)).toThrow(InvalidMailAddressError);
    }
  });

  it("refuses angle brackets", () => {
    for (const address of ["ada@example.com>", "<ada@example.com", "Ada <ada@example.com>"]) {
      expect(() => assertMailAddress(address)).toThrow(InvalidMailAddressError);
    }
  });

  it("refuses a comma or semicolon, which would make one address a list", () => {
    for (const address of [
      "ada@example.com,eve@evil.test",
      "ada@example.com;eve@evil.test",
      "ada,@example.com",
    ]) {
      expect(() => assertMailAddress(address)).toThrow(InvalidMailAddressError);
    }
  });

  it("refuses an address longer than an SMTP path allows", () => {
    expect(() => assertMailAddress(`${"a".repeat(64)}@${"b".repeat(184)}.test`)).not.toThrow();
    expect(() => assertMailAddress(`${"a".repeat(64)}@${"b".repeat(185)}.test`)).toThrow(
      InvalidMailAddressError,
    );
  });

  it("refuses a value that is not a string", () => {
    for (const value of [undefined, null, 42, { address: "ada@example.com" }]) {
      expect(() => assertMailAddress(value)).toThrow(InvalidMailAddressError);
    }
  });

  it("throws a typed notification error whose message cannot split a log line", () => {
    let caught: unknown;
    try {
      assertMailAddress("ada@example.com\r\nRSET");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidMailAddressError);
    expect(caught).toBeInstanceOf(NotificationError);
    const error = caught as InvalidMailAddressError;
    expect(error.code).toBe("E_NOTIFICATION_INVALID_ADDRESS");
    expect(error.message).not.toMatch(/[\r\n]/);
    expect(error.message).toContain(String.raw`ada@example.com\r\nRSET`);
  });
});

describe("resolveAddress", () => {
  it("checks the address whether it arrives as a string or an object", () => {
    expect(resolveAddress("ada@example.com")).toEqual({ address: "ada@example.com" });
    expect(resolveAddress({ address: "ada@example.com", name: "Ada" })).toEqual({
      address: "ada@example.com",
      name: "Ada",
    });
    expect(() => resolveAddress("ada@example.com\nRSET")).toThrow(InvalidMailAddressError);
    expect(() => resolveAddress({ address: "ada@example.com\nRSET" })).toThrow(
      InvalidMailAddressError,
    );
  });

  it("splits 'Display Name <address>' into a name and an address", () => {
    const cases: Array<[string, { address: string; name?: string }]> = [
      ["Ada Lovelace <ada@example.com>", { address: "ada@example.com", name: "Ada Lovelace" }],
      ["  Ada <ada@example.com>  ", { address: "ada@example.com", name: "Ada" }],
      ["\tAda\t<ada@example.com>", { address: "ada@example.com", name: "Ada" }],
      ['"Lovelace, Ada" <ada@example.com>', { address: "ada@example.com", name: "Lovelace, Ada" }],
      ["Ada<ada@example.com>", { address: "ada@example.com", name: "Ada" }],
      ["<ada@example.com>", { address: "ada@example.com" }],
      ['"" <ada@example.com>', { address: "ada@example.com" }],
      ["Jörg <jörg@exämple.de>", { address: "jörg@exämple.de", name: "Jörg" }],
    ];
    for (const [input, expected] of cases) {
      expect(resolveAddress(input)).toEqual(expected);
    }
  });

  it("splits the display form inside an object, the written name taking the object's place", () => {
    expect(resolveAddress({ address: "Ada <ada@example.com>", name: "Default" })).toEqual({
      address: "ada@example.com",
      name: "Ada",
    });
    expect(resolveAddress({ address: "<ada@example.com>", name: "Default" })).toEqual({
      address: "ada@example.com",
      name: "Default",
    });
  });

  it("refuses the display form with a control character in the name", () => {
    for (const input of [
      "Ada\r\nBcc: spy@example.com <ada@example.com>",
      "Ada\n<ada@example.com>",
      "Ada\r <ada@example.com>",
      "\r\nAda <ada@example.com>",
      '"Ada\r\nBcc: spy@example.com" <ada@example.com>',
      "Ada\x00 <ada@example.com>",
    ]) {
      expect(() => resolveAddress(input)).toThrow(InvalidMailAddressError);
      expect(() => resolveAddress({ address: input })).toThrow(InvalidMailAddressError);
    }
  });

  it("refuses the display form with a bad address inside the brackets", () => {
    for (const input of [
      "Ada <ada@example.com\r\nRSET>",
      "Ada <ada@example.com\nRSET>",
      "Ada <ada @example.com>",
      "Ada <ada@example.com>\r\n",
      "Ada <ada@example.com>\r\nRCPT TO:<spy@example.com>",
    ]) {
      expect(() => resolveAddress(input)).toThrow(InvalidMailAddressError);
    }
  });

  it("refuses anything else with '<' or '>' in it", () => {
    for (const input of [
      "Ada <ada@example.com",
      "Ada ada@example.com>",
      "Ada <<ada@example.com>>",
      "Ada <ada@example.com> <spy@example.com>",
      "Ada <ada@example.com> trailing",
      'Ada "x" <ada@example.com>',
      '"Ada <ada@example.com>',
      "ada@example.com>",
      "<ada@example.com",
      "Ada >ada@example.com<",
      '"Ada <spy@example.com>" <ada@example.com>',
      '"Ada >" <ada@example.com>',
      "Ada <>",
      "<>",
    ]) {
      expect(() => resolveAddress(input)).toThrow(InvalidMailAddressError);
    }
  });

  it("refuses an object's own name with a line break or control character in it", () => {
    // The name on an object usually comes from user data, a profile name on the
    // notifiable, so it is checked as closely as one written into the address.
    const bad = [
      "Ada\r\nBcc: spy@example.com",
      "Ada\n",
      "\rAda",
      "Ada\x00",
      "Ada\x7f",
      ...UNICODE_BREAKS.map((separator) => `Ada${separator}Bcc: spy@example.com`),
    ];
    for (const name of bad) {
      expect(() => resolveAddress({ address: "ada@example.com", name })).toThrow(
        InvalidMailAddressError,
      );
      // Also when a name written into the address takes its place.
      expect(() => resolveAddress({ address: "Ada <ada@example.com>", name })).toThrow(
        InvalidMailAddressError,
      );
    }
  });

  it("refuses NEL and the Unicode separators in a name written into the address", () => {
    for (const separator of UNICODE_BREAKS) {
      for (const input of [
        `Ada${separator}Bcc: spy@example.com <ada@example.com>`,
        `"Ada${separator}" <ada@example.com>`,
      ]) {
        expect(() => resolveAddress(input)).toThrow(InvalidMailAddressError);
        expect(() => resolveAddress({ address: input })).toThrow(InvalidMailAddressError);
      }
    }
  });

  it("refuses an object's name that is not a string, and treats null as no name", () => {
    for (const name of [42, {}, ["Ada"]]) {
      expect(() =>
        resolveAddress({ address: "ada@example.com", name } as unknown as { address: string }),
      ).toThrow(InvalidMailAddressError);
    }
    // A nullable profile column handed straight through is no name, not an error.
    const resolved = resolveAddress({ address: "ada@example.com", name: null } as unknown as {
      address: string;
    });
    expect(resolved.address).toBe("ada@example.com");
    expect(_formatMailbox(resolved)).toBe("ada@example.com");
  });

  it("keeps quotes, backslashes, commas and angle brackets in an object's name", () => {
    // These are only dangerous to a driver that writes the name out bare, and none
    // does: see _formatMailbox below.
    for (const name of ["spy <spy@example.com>, Ada", 'Ada "the" Countess', "Ada\\"]) {
      expect(resolveAddress({ address: "ada@example.com", name })).toEqual({
        address: "ada@example.com",
        name,
      });
    }
  });

  it("does not echo a refused name in the error", () => {
    let caught: unknown;
    try {
      resolveAddress({ address: "ada@example.com", name: `secret${LINE_SEPARATOR}name` });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidMailAddressError);
    expect((caught as Error).message).toContain('"ada@example.com"');
    expect((caught as Error).message).not.toContain("secret");
  });

  it("escapes NEL and the Unicode separators when the error quotes an address", () => {
    for (const separator of UNICODE_BREAKS) {
      let caught: unknown;
      try {
        assertMailAddress(`ada@example.com${separator}RSET`);
      } catch (error) {
        caught = error;
      }
      expect((caught as Error).message).not.toContain(separator);
      expect((caught as Error).message).toContain("ada@example.com\\u");
    }
  });
});

describe("_assertPayloadAddresses", () => {
  it("refuses a display name with a line break on any address of a payload", () => {
    const name = `Ada${LINE_SEPARATOR}Bcc: spy@example.com`;
    const base = { from: { address: "app@example.com" }, to: [{ address: "a@example.com" }] };
    for (const payload of [
      { ...base, from: { address: "app@example.com", name } },
      { ...base, to: [{ address: "a@example.com", name }] },
      { ...base, cc: [{ address: "c@example.com", name }] },
      { ...base, bcc: [{ address: "b@example.com", name }] },
      { ...base, replyTo: { address: "r@example.com", name } },
    ]) {
      expect(() => _assertPayloadAddresses({ subject: "Hi", ...payload })).toThrow(
        InvalidMailAddressError,
      );
    }
  });
});

describe("_formatMailbox", () => {
  it("writes the bare address when there is no name", () => {
    expect(_formatMailbox({ address: "ada@example.com" })).toBe("ada@example.com");
    expect(_formatMailbox({ address: "ada@example.com", name: "  " })).toBe("ada@example.com");
  });

  it("quotes a printable ASCII name", () => {
    expect(_formatMailbox({ address: "ada@example.com", name: "Ada Lovelace" })).toBe(
      '"Ada Lovelace" <ada@example.com>',
    );
  });

  it("keeps a comma and a bracketed address inside the quotes", () => {
    expect(_formatMailbox({ address: "ada@example.com", name: "x <spy@example.com>, y" })).toBe(
      '"x <spy@example.com>, y" <ada@example.com>',
    );
  });

  it("escapes a double quote as a quoted-pair", () => {
    expect(_formatMailbox({ address: "ada@example.com", name: 'Ada "the" Countess' })).toBe(
      String.raw`"Ada \"the\" Countess" <ada@example.com>`,
    );
  });

  it("escapes a trailing backslash, so it cannot escape the closing quote", () => {
    expect(_formatMailbox({ address: "ada@example.com", name: "Ada\\" })).toBe(
      String.raw`"Ada\\" <ada@example.com>`,
    );
    expect(_formatMailbox({ address: "ada@example.com", name: 'Ada\\"' })).toBe(
      String.raw`"Ada\\\"" <ada@example.com>`,
    );
  });

  it("encodes a name outside printable ASCII as encoded-words, never quoted", () => {
    const name = 'Jörg "x <spy@example.com>, y"';
    const formatted = _formatMailbox({ address: "jorg@example.com", name });
    expect(formatted.endsWith(" <jorg@example.com>")).toBe(true);
    const words = formatted.slice(0, -" <jorg@example.com>".length);
    expect(words).not.toContain('"');
    expect(words).not.toContain("<");
    expect(decodeWords(words)).toBe(name);
  });

  it("keeps each encoded-word within 75 characters, split between characters", () => {
    const name = "Ünïcödé ☕ ".repeat(12) + "😀".repeat(20);
    const formatted = _formatMailbox({ address: "ada@example.com", name: name.trim() });
    const words = formatted.slice(0, -" <ada@example.com>".length);
    for (const word of words.split(" ")) expect(word.length).toBeLessThanOrEqual(75);
    expect(words.split(" ").length).toBeGreaterThan(1);
    expect(decodeWords(words)).toBe(name.trim());
  });
});
