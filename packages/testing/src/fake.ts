/**
 * @zerotal/testing — fake data generator
 *
 * South-African-flavoured faker for use in factories, seeders, and tests.
 * Zero external dependencies — all data lives in data.ts.
 *
 * @example
 * import { fake } from '@zerotal/testing';
 *
 * fake.name()                     // "Sipho Dlamini"
 * fake.email()                    // "sipho.dlamini73@gmail.com"
 * fake.email({ corporate: true }) // "sipho.dlamini@shoprite.co.za"
 * fake.sentence()                 // medium sentence
 * fake.sentence({ length: 'long' })
 * fake.paragraphs(3)              // 3 paragraphs joined with \n\n
 * fake.phone()                    // "071 234 5678"
 */

import {
  firstNames,
  lastNames,
  cities,
  provinces,
  suburbs,
  streetNames,
  streetTypes,
  emailDomains,
  companies,
  mobileAreaCodes,
  postalCodes,
  jobTitles,
  departments,
  loremNouns,
  loremAdjectives,
  loremVerbs,
  loremFillers,
  titlePhrases,
} from "./data.ts";
import { Str } from "@zerotal/core";

// ── Internal helpers ──────────────────────────────────────────────────────────

function rng(): number {
  return Math.random();
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

function pickN<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy[idx] as T);
    copy.splice(idx, 1);
  }
  return out;
}

function int(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

const capitalize = (s: string): string => Str.capitalize(s);
const slugify = (text: string): string => Str.slugify(text);

function companyDomain(company: string): string {
  // Well-known abbreviations
  const abbrevs: Record<string, string> = {
    "first national bank": "fnb",
    "pick n pay": "picknpay",
    "amazon web services": "aws",
    "microsoft south africa": "microsoft",
    "old mutual": "oldmutual",
    "standard bank": "standardbank",
    discovery: "discovery",
    "dis-chem": "dischem",
    "cell c": "cellc",
  };
  const key = company.toLowerCase();
  const base = abbrevs[key] ?? key.replace(/[^a-z0-9]/g, "");
  return `${base}.co.za`;
}

// ── Sentence / paragraph builder ──────────────────────────────────────────────

type TextLength = "short" | "medium" | "long";

const WORD_COUNTS: Record<TextLength, [number, number]> = {
  short: [5, 9],
  medium: [11, 18],
  long: [22, 38],
};

const SENTENCE_COUNTS: Record<TextLength, [number, number]> = {
  short: [2, 3],
  medium: [3, 5],
  long: [5, 8],
};

// Sentence patterns — each token is picked from the right pool
// Format:  N=noun  A=adjective  V=verb  F=filler  W=any
const PATTERNS: Array<Array<"N" | "A" | "V" | "F">> = [
  ["A", "N", "V", "N"],
  ["N", "V", "A", "N"],
  ["A", "N", "V", "A", "N"],
  ["V", "A", "N", "F", "N"],
  ["N", "F", "N", "V", "A", "N"],
  ["A", "N", "F", "V", "N"],
  ["V", "N", "A", "F", "A", "N"],
  ["N", "V", "N", "F", "N"],
];

function buildSentence(): string {
  const pattern = pick(PATTERNS);
  const tokens = pattern.map((t) => {
    switch (t) {
      case "N":
        return pick(loremNouns);
      case "A":
        return pick(loremAdjectives);
      case "V":
        return pick(loremVerbs);
      case "F":
        return pick(loremFillers);
    }
  });
  return capitalize(tokens.join(" ")) + ".";
}

function buildWordSentence(wordCount: number): string {
  // Single words only. The vocab holds a few noun *phrases* ("blog post"), so
  // picking `wordCount` entries from the whole pool yields a sentence of more
  // than `wordCount` words whenever a phrase is drawn — `fake.word()` already
  // filters them out for the same reason.
  const pool = singleWords();
  const words = Array.from({ length: wordCount }, () => pick(pool));
  return capitalize(words.join(" ")) + ".";
}

/** The lorem vocabulary with multi-word phrases removed. */
function singleWords(): string[] {
  return [...loremNouns, ...loremAdjectives, ...loremVerbs].filter((w) => !w.includes(" "));
}

// ── Public API ────────────────────────────────────────────────────────────────

export const fake = {
  // ── Primitives ──────────────────────────────────────────────────────────────

  /** Random element from an array. */
  pick<T>(arr: readonly T[]): T {
    return pick(arr);
  },

  /** Shuffled copy of an array. */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  },

  /** n unique random elements from an array. */
  sample<T>(arr: readonly T[], n: number): T[] {
    return pickN(arr, n);
  },

  /** Random integer between min and max (inclusive). */
  number(min = 0, max = 1000): number {
    return int(min, max);
  },

  /** Random float between min and max with optional decimal places. */
  float(min = 0, max = 1, decimals = 2): number {
    const raw = rng() * (max - min) + min;
    return Number(raw.toFixed(decimals));
  },

  /** Random boolean, optionally weighted (default 50/50). */
  boolean(trueWeight = 0.5): boolean {
    return rng() < trueWeight;
  },

  /** UUID v4. */
  uuid(): string {
    return crypto.randomUUID();
  },

  /** Random alphanumeric string of given length. */
  string(length = 10): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (let i = 0; i < length; i++) out += pick([...chars]);
    return out;
  },

  /**
   * Return value with given probability; null otherwise.
   * @example fake.maybe(fake.phone(), 0.7)  // phone 70% of the time
   */
  maybe<T>(value: T, probability = 0.5): T | null {
    return rng() < probability ? value : null;
  },

  // ── Dates ────────────────────────────────────────────────────────────────────

  /** Random Date in the given range (defaults: last year → now). */
  date(from?: Date, to?: Date): Date {
    const end = (to ?? new Date()).getTime();
    const start = (from ?? new Date(end - 365 * 24 * 60 * 60 * 1000)).getTime();
    return new Date(start + rng() * (end - start));
  },

  /** Random Date in the past, within `years` years. */
  pastDate(years = 3): Date {
    const now = Date.now();
    return new Date(now - rng() * years * 365 * 24 * 60 * 60 * 1000);
  },

  /** Random Date in the future, within `years` years. */
  futureDate(years = 2): Date {
    const now = Date.now();
    return new Date(now + rng() * years * 365 * 24 * 60 * 60 * 1000);
  },

  /** ISO 8601 date string (e.g. "2024-03-15T10:23:00.000Z"). */
  isoDate(from?: Date, to?: Date): string {
    return fake.date(from, to).toISOString();
  },

  /** Unix timestamp in seconds. */
  timestamp(): number {
    return Math.floor(fake.date().getTime() / 1000);
  },

  // ── Names ────────────────────────────────────────────────────────────────────

  /** Random first name drawn from the full SA-diverse pool. */
  firstName(): string {
    return pick(firstNames);
  },

  /** Random last name drawn from the full SA-diverse pool. */
  lastName(): string {
    return pick(lastNames);
  },

  /** Full name: "FirstName LastName". */
  name(): string {
    return `${fake.firstName()} ${fake.lastName()}`;
  },

  // ── Contact ──────────────────────────────────────────────────────────────────

  /**
   * Realistic email address.
   *
   * @param opts.name      Seed string (defaults to a generated name).
   * @param opts.corporate If true, uses a slugified company domain (.co.za).
   * @param opts.number    Append a number to the local part (default: 50% chance).
   */
  email(opts?: { name?: string; corporate?: boolean; number?: boolean }): string {
    const rawName = opts?.name ?? fake.name();
    const parts = rawName
      .toLowerCase()
      .replace(/[^a-z\s]/g, "")
      .split(/\s+/)
      .filter(Boolean);
    const style = int(0, 2);

    let local: string;
    if (style === 0 && parts.length >= 2) {
      local = `${parts[0]}.${parts[1]}`;
    } else if (style === 1 && parts.length >= 2) {
      local = `${parts[0]![0]}${parts[1]}`;
    } else {
      local = parts[0] ?? "user";
    }

    const addNum = opts?.number ?? rng() < 0.4;
    if (addNum) local += int(1, 99);

    const domain = opts?.corporate ? companyDomain(pick(companies)) : pick(emailDomains);

    return `${local}@${domain}`;
  },

  /**
   * SA mobile phone number.
   * Format: "0XX XXX XXXX"
   */
  phone(): string {
    const area = pick(mobileAreaCodes);
    const mid = String(int(100, 999));
    const last = String(int(1000, 9999));
    return `${area} ${mid} ${last}`;
  },

  // ── Location ─────────────────────────────────────────────────────────────────

  city(): string {
    return pick(cities);
  },
  province(): string {
    return pick(provinces);
  },
  suburb(): string {
    return pick(suburbs);
  },

  /** "12 Mandela Street" style address line. */
  streetAddress(): string {
    return `${int(1, 299)} ${pick(streetNames)} ${pick(streetTypes)}`;
  },

  /** 4-digit SA postal code. */
  postalCode(): string {
    return pick(postalCodes);
  },

  /** Full postal address. */
  address(): string {
    return [
      fake.streetAddress(),
      pick(suburbs),
      pick(cities),
      pick(provinces),
      fake.postalCode(),
    ].join(", ");
  },

  // ── Organisation ─────────────────────────────────────────────────────────────

  company(): string {
    return pick(companies);
  },
  jobTitle(): string {
    return pick(jobTitles);
  },
  department(): string {
    return pick(departments);
  },

  // ── Text ─────────────────────────────────────────────────────────────────────

  /** Single word from the lorem vocabulary. */
  word(): string {
    // The vocab includes a few noun *phrases* ("blog post", "trade show") that are
    // useful for sentences but not for a single word — exclude anything with a space.
    return pick(singleWords());
  },

  /** n space-joined words. */
  words(n = 5): string {
    // Single words, so `words(n).split(" ")` really has n entries.
    const pool = singleWords();
    return Array.from({ length: n }, () => pick(pool)).join(" ");
  },

  /**
   * A single sentence.
   *
   * @param opts.length  'short' (5-9 words) | 'medium' (11-18) | 'long' (22-38). Default: 'medium'.
   * @param opts.words   Exact word count override.
   */
  sentence(opts?: { length?: TextLength; words?: number }): string {
    if (opts?.words) return buildWordSentence(opts.words);
    const len = opts?.length ?? "medium";
    const [min, max] = WORD_COUNTS[len];
    if (len === "short") return buildSentence();
    return buildWordSentence(int(min, max));
  },

  /** n sentences joined with a space. */
  sentences(n = 3, opts?: { length?: TextLength }): string {
    return Array.from({ length: n }, () => fake.sentence(opts)).join(" ");
  },

  /**
   * A paragraph of sentences.
   *
   * @param opts.length  'short' (2-3 sentences) | 'medium' (3-5) | 'long' (5-8). Default: 'medium'.
   */
  paragraph(opts?: { length?: TextLength }): string {
    const len = opts?.length ?? "medium";
    const [min, max] = SENTENCE_COUNTS[len];
    const n = int(min, max);
    return Array.from({ length: n }, () => fake.sentence({ length: len })).join(" ");
  },

  /** n paragraphs joined with a blank line. */
  paragraphs(n = 3, opts?: { length?: TextLength }): string {
    return Array.from({ length: n }, () => fake.paragraph(opts)).join("\n\n");
  },

  // ── Titles & slugs ───────────────────────────────────────────────────────────

  /**
   * A realistic article/post title.
   * Returns a pre-written phrase 70% of the time; constructs one otherwise.
   */
  title(): string {
    if (rng() < 0.7) return pick(titlePhrases);
    const adj = capitalize(pick(loremAdjectives));
    const noun = capitalize(pick(loremNouns));
    const verb = capitalize(pick(loremVerbs));
    return pick([
      `${verb}ing ${adj} ${noun}s`,
      `Understanding ${adj} ${noun}`,
      `A Guide to ${adj} ${noun}`,
      `${adj} ${noun}: Best Practices`,
      `How to ${verb} Your ${noun}`,
      `The ${adj} ${noun} Playbook`,
    ]);
  },

  /** URL-safe slug from a title or generated one. */
  slug(text?: string): string {
    return slugify(text ?? fake.title());
  },

  // ── URLs & passwords ─────────────────────────────────────────────────────────

  /** Random HTTPS URL. */
  url(opts?: { path?: boolean }): string {
    const domain = companyDomain(pick(companies));
    const path = opts?.path !== false ? `/${fake.slug()}-${int(1, 999)}` : "";
    return `https://www.${domain}${path}`;
  },

  /**
   * Realistic-looking password.
   *
   * @param opts.length  Total length (default: 12).
   * @param opts.simple  If true, lowercase + digits only (for test fixtures).
   */
  password(opts?: { length?: number; simple?: boolean }): string {
    const len = opts?.length ?? 12;
    if (opts?.simple) return fake.string(len);

    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower = "abcdefghjkmnpqrstuvwxyz";
    const digits = "23456789";
    const syms = "!@#$%^&*";

    // Guarantee at least one of each type
    const out = [pick([...upper]), pick([...lower]), pick([...digits]), pick([...syms])];

    const all = upper + lower + digits + syms;
    while (out.length < len) out.push(pick([...all]));

    // Shuffle to avoid predictable prefix
    return fake.shuffle(out).join("");
  },
};

export type Fake = typeof fake;
