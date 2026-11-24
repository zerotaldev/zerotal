/**
 * Shared form styling, so every auth screen looks like the same application.
 *
 * Plain string constants rather than components: Flow renders on the server and
 * these are only class lists, so a constant is the whole abstraction needed.
 */
export const CARD = "mx-auto w-full max-w-sm rounded-2xl border border-gray-200/70 bg-white p-8 shadow-sm";

export const LABEL = "block text-sm font-medium text-gray-900";

export const FIELD =
  "mt-1.5 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 " +
  "outline-none transition placeholder:text-gray-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30";

export const PRIMARY =
  "w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition " +
  "hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60";

export const SECONDARY =
  "rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 " +
  "transition hover:bg-gray-50";

export const ERROR =
  "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700";

export const NOTICE =
  "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700";
