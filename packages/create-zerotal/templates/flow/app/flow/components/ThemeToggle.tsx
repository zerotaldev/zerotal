import type { HtmlNode } from "@zerotal/flow";
import { Dropdown } from "./Dropdown";
import { Icon } from "./Icon";

/**
 * Light / dark / system, from a small menu. Settings → Appearance offers the same three;
 * both read and write the same stored choice (resources/js/lib/theme.ts).
 *
 * The page is written before the browser has said which it prefers, so all three icons
 * are here and the script shows the one that applies.
 */
export function ThemeToggle({ class: className }: { class?: string }): HtmlNode {
  return (
    <Dropdown
      class={className}
      label="Theme"
      trigger={
        <span class="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <span data-appearance-icon="light" hidden>
            <Icon name="sun" class="size-4.5" />
          </span>
          <span data-appearance-icon="dark" hidden>
            <Icon name="moon" class="size-4.5" />
          </span>
          <span data-appearance-icon="system">
            <Icon name="laptop" class="size-4.5" />
          </span>
        </span>
      }
      items={[
        { label: "Light", icon: "sun", appearance: "light" },
        { label: "Dark", icon: "moon", appearance: "dark" },
        { label: "System", icon: "laptop", appearance: "system" },
      ]}
    />
  );
}
