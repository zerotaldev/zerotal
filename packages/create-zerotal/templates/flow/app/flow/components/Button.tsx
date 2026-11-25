import type { HtmlNode } from "@zerotal/flow";
import { buttonClass, type ButtonSize, type ButtonVariant } from "../lib/button";

/**
 * The app's buttons. Given `href` it renders a link with identical styling, so a nav
 * action and a form submit can't drift apart. Both are built from `buttonClass()` in
 * lib/button.ts, which a bare `<a>` can use too.
 *
 * Anything else — `aria-label`, `data-open-modal`, `name`, `value` — passes through to
 * the element.
 */
export function Button({
  variant,
  size,
  class: className,
  type = "button",
  href,
  children,
  ...rest
}: {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  class?: string | undefined;
  type?: "button" | "submit" | undefined;
  href?: string | undefined;
  children?: unknown;
  [attribute: string]: unknown;
}): HtmlNode {
  const classes = buttonClass(variant, size, className);
  return href ? (
    <a href={href} class={classes} {...rest}>
      {children}
    </a>
  ) : (
    <button type={type} class={classes} {...rest}>
      {children}
    </button>
  );
}
