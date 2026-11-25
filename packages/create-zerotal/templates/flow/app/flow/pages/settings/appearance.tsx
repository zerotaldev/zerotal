import type { HtmlNode } from "@zerotal/flow";
import { SettingsLayout } from "../../layouts/SettingsLayout";
import type { IconName } from "../../lib/icons";
import { Page, titled } from "../../lib/page";
import { CARD, CARD_BODY, CARD_DESCRIPTION, CARD_HEADER, CARD_TITLE, icon } from "../../lib/ui";

const OPTIONS: {
  value: "light" | "dark" | "system";
  label: string;
  description: string;
  icon: IconName;
}[] = [
  { value: "light", label: "Light", description: "Always light.", icon: "sun" },
  { value: "dark", label: "Dark", description: "Always dark.", icon: "moon" },
  { value: "system", label: "System", description: "Match this device.", icon: "laptop" },
];

/**
 * GET /settings/appearance — light, dark or system. The choice is kept in the browser, so
 * there is nothing for the server to save: resources/js/lib/theme.ts applies it and marks
 * the current option (`data-checked`).
 */
export class AppearancePage extends Page {
  static override title = titled("Appearance");

  override layout(page: HtmlNode): HtmlNode {
    return <SettingsLayout shell={this.shell()}>{page}</SettingsLayout>;
  }

  override async render(): Promise<HtmlNode> {
    return (
      <div class={CARD}>
        <div class={CARD_HEADER}>
          <div class="min-w-0">
            <h2 class={CARD_TITLE}>Appearance</h2>
            <p class={CARD_DESCRIPTION}>
              Kept in this browser, so each of your devices can have its own.
            </p>
          </div>
        </div>
        <div class={CARD_BODY}>
          <fieldset>
            <legend class="sr-only">Theme</legend>
            <div class="grid gap-3 sm:grid-cols-3">
              {OPTIONS.map((option) => (
                <label class="group flex cursor-pointer flex-col gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring data-checked:border-primary data-checked:bg-accent data-checked:hover:bg-accent">
                  <input
                    type="radio"
                    name="appearance"
                    data-appearance={option.value}
                    class="sr-only"
                  />
                  <span class="text-muted-foreground group-data-checked:text-primary">
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      class="size-5"
                      dangerouslySetInnerHTML={icon(option.icon)}
                    />
                  </span>
                  <span>
                    <span class="block text-sm font-medium">{option.label}</span>
                    <span class="block text-sm text-muted-foreground">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </div>
    );
  }
}
