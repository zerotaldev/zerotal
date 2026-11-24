import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { CONTROL, controlBorder } from "./Input";
import { ChevronDownIcon } from "./Icon";

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
  className,
  ...rest
}: ComponentProps<"select"> & { options: readonly SelectOption[] }) {
  return (
    <div className="relative">
      <select
        className={cn(
          CONTROL,
          "appearance-none pr-9",
          controlBorder(rest["aria-invalid"] === true),
          className,
        )}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
