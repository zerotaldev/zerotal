import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";
import { Icon } from "./Icon";
import { SELECT, SELECT_CHEVRON } from "../lib/ui";

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
      <select class={cn(SELECT, className)} {...rest}>
        {options.map((option) => (
          <option value={option.value} selected={option.value === value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" class={SELECT_CHEVRON} />
    </div>
  );
}
