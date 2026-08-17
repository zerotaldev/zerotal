import { router, usePage } from "@inertiajs/react";
import { GlobeIcon } from "./Icons";
import { endpoint } from "../lib/endpoint";
import { currentLocale } from "../lib/i18n";
import { cn } from "../lib/cn";
import type { SharedProps } from "../types";

/**
 * Choosing a language without an account.
 *
 * Signed-in readers have this in Settings, backed by a column. A visitor has no
 * row to write to, so the choice goes in a `locale` cookie — which the resolver
 * chain in `config/i18n.ts` was already reading and nothing was writing.
 *
 * A cookie rather than `localStorage` because the decision is the *server's*:
 * every page here is rendered server-side before any script runs, so a
 * preference the browser keeps to itself would arrive one navigation too late.
 * A cookie is on the request that renders the page.
 *
 * Submits on change and reloads, because the whole page — including anything
 * already rendered on the server — has to come back in the new language.
 */
export default function LanguagePicker({ className }: { className?: string }) {
  const current = currentLocale();
  const locales = (usePage<SharedProps>().props.locales ?? []) as { code: string; name: string }[];

  if (locales.length < 2) return null;

  return (
    <label className={cn("flex items-center gap-2", className)}>
      <GlobeIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="sr-only">{__("Choose a language")}</span>

      <select
        value={current}
        onChange={(event) => {
          const { url, method } = endpoint("locale.store");
          router.visit(url, { method, data: { locale: event.target.value } });
        }}
        className="h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground focus:border-ring focus:ring-2 focus:ring-ring/15 focus:outline-none"
      >
        {locales.map((locale) => (
          <option key={locale.code} value={locale.code}>
            {locale.name}
          </option>
        ))}
      </select>
    </label>
  );
}
