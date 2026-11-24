import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";
import { CONTROL, CONTROL_BORDER } from "./Input";
import { Icon } from "./Icon";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * A native `<select>`, styled to match the inputs. Native on purpose: it is keyboard- and
 * screen-reader-accessible for free, and on a phone it opens the system picker.
 */
export function Select({
  options,
  value,
  class: className,
  ...rest
}: {
  options: readonly SelectOption[];
  value?: string | undefined;
  class?: string | undefined;
  [attribute: string]: unknown;
}): HtmlNode {
  return (
    <div class="relative">
      <select class={cn(CONTROL, CONTROL_BORDER, "appearance-none pr-9", className)} {...rest}>
        {options.map((option) => (
          <option value={option.value} selected={option.value === value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon
        name="chevron-down"
        class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
