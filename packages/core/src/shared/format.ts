/**
 * Formatting both sides of the wire can agree on.
 *
 * The problem this solves is not that formatting is hard. `Intl` is in every
 * runtime the framework targets and does the work. The problem is that a server
 * helper and a browser helper are two places to make the same decision, and a
 * total that reads `R 39 147` on screen and `R39,147.00` on the invoice looks like
 * two different numbers to the person paying it.
 *
 * So these are deliberately thin — they fix the options, not the arithmetic. The
 * value is that there is one definition of "how this app writes money" and both
 * the controller and the component import it.
 *
 * Everything here is pure and dependency-free, and this module is reachable from
 * `zerotal/shared`, so it bundles into a browser build without pulling the
 * framework in behind it.
 *
 * @module
 */

/** How a value should be written. */
export interface FormatOptions {
  /**
   * BCP-47 locale. Defaults to the runtime's — which on a server is the machine's
   * and in a browser is the reader's, and those are not the same. Pass one
   * explicitly wherever the two sides must match, and they usually must.
   */
  locale?: string | undefined;
}

/** How money should be written. */
export interface MoneyOptions extends FormatOptions {
  /** ISO 4217 code — `ZAR`, `USD`, `EUR`. */
  currency: string;
  /**
   * Whether the amount is in the currency's minor unit (cents), which is how a
   * database column that must not lose a cent stores it. Default `true`, because
   * an app that stores money in a float has a different problem.
   */
  minorUnits?: boolean | undefined;
  /** Digits after the decimal point. Defaults to whatever the currency uses. */
  fractionDigits?: number | undefined;
}

/**
 * Write an amount of money.
 *
 * @param amount - The amount, in minor units unless `minorUnits: false`.
 * @param options - Currency, and how to write it.
 *
 * @example
 * ```ts
 * formatMoney(3_914_700, { currency: "ZAR", locale: "en-ZA" });  // "R 39 147,00"
 * formatMoney(39_147, { currency: "USD", minorUnits: false });   // "$39,147.00"
 * ```
 */
export function formatMoney(amount: number, options: MoneyOptions): string {
  const { currency, locale, minorUnits = true, fractionDigits } = options;
  const value = minorUnits ? amount / 100 : amount;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    ...(fractionDigits !== undefined
      ? { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }
      : {}),
  }).format(value);
}

/** How a plain number should be written. */
export interface NumberOptions extends FormatOptions {
  /** Smallest number of digits after the decimal point. */
  minimumFractionDigits?: number | undefined;
  /** Largest number of digits after the decimal point. */
  maximumFractionDigits?: number | undefined;
}

/**
 * Write a number with the reader's group and decimal separators.
 *
 * @example
 * ```ts
 * formatNumber(39147.5, { locale: "en-GB", maximumFractionDigits: 1 });  // "39,147.5"
 * ```
 */
export function formatNumber(value: number, options: NumberOptions = {}): string {
  const { locale, ...rest } = options;
  return new Intl.NumberFormat(locale, rest).format(value);
}

/** How a date should be written. */
export interface DateOptions extends FormatOptions {
  /** Length of the date part. Omit for none. */
  dateStyle?: "full" | "long" | "medium" | "short" | undefined;
  /** Length of the time part. Omit for none. */
  timeStyle?: "full" | "long" | "medium" | "short" | undefined;
  /**
   * IANA zone — `Africa/Johannesburg`, `UTC`.
   *
   * Worth passing on the server. A machine set to UTC and a reader in Cape Town
   * disagree about which day an 11pm booking happened on, and that is the shape
   * the bug takes: not a wrong time, a wrong date.
   */
  timeZone?: string | undefined;
}

/**
 * Write a date or timestamp.
 *
 * @param value - A `Date`, an epoch-milliseconds number, or an ISO string.
 * @param options - Which parts to write, and in whose zone.
 *
 * @example
 * ```ts
 * formatDate("2026-08-28T21:00:00Z", {
 *   locale: "en-ZA",
 *   dateStyle: "medium",
 *   timeZone: "Africa/Johannesburg",
 * });
 * ```
 */
export function formatDate(value: Date | number | string, options: DateOptions = {}): string {
  const { locale, ...rest } = options;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // `Intl` given neither style writes the date and nothing else, which is the
  // useful default for a helper named `formatDate`. Spread rather than replaced:
  // the default has to keep `timeZone`, or a caller who passed a zone and no style
  // silently gets the machine's — which is the exact wrong-day bug the option is
  // there to prevent.
  const noStyle = rest.dateStyle === undefined && rest.timeStyle === undefined;
  return new Intl.DateTimeFormat(locale, {
    ...rest,
    ...(noStyle ? { dateStyle: "medium" as const } : {}),
  }).format(date);
}
