/** @jsxImportSource @zerotal/flow */
// ── <Prose> and the heading helpers ─────────────────────────────────────────
//
// Text styling for content that arrives as a blob — a rendered Markdown file, a
// CMS field, a rich-text column — where you cannot put a class on each element
// because you did not write the elements.
//
// <Prose> styles its descendants instead. Everywhere you *do* control the markup,
// use the individual helpers or plain utilities; a wrapper that restyles all
// descendants is a blunt instrument and should not be reached for by default.
//
//   <Prose dangerouslySetInnerHTML={{ __html: rendered }} />
//   <H1>Page title</H1>
//   <Muted>Last updated yesterday</Muted>

import { jsx } from "@zerotal/flow/jsx-runtime";
import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface TextProps {
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

/** One element's worth of styled text. */
const text =
  (tag: string, base: string) =>
  (props: TextProps): HtmlNode => {
    const { class: cls, children, ...rest } = props;
    return jsx(tag, { ...rest, class: cn(base, cls), children });
  };

export const H1 = text("h1", "scroll-m-20 text-3xl font-semibold tracking-tight");
export const H2 = text(
  "h2",
  "scroll-m-20 border-b border-border pb-2 text-2xl font-semibold tracking-tight",
);
export const H3 = text("h3", "scroll-m-20 text-xl font-semibold tracking-tight");
export const H4 = text("h4", "scroll-m-20 text-base font-semibold tracking-tight");
export const P = text("p", "leading-7 [&:not(:first-child)]:mt-4");
export const Lead = text("p", "text-lg text-muted-foreground");
export const Muted = text("p", "text-sm text-muted-foreground");
export const Small = text("small", "text-sm font-medium leading-none");
export const Code = text(
  "code",
  "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm",
);
export const Blockquote = text("blockquote", "mt-4 border-l-2 border-border pl-4 italic");
export const List = text("ul", "my-4 ml-6 list-disc [&>li]:mt-2");

export interface ProseProps {
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

/**
 * Descendant styling for markup you did not author.
 *
 * Kept to the elements a Markdown renderer actually emits. Styling every
 * possible tag would be thorough and would also mean this quietly overrides
 * components dropped inside it, which is the failure mode of a wrapper like
 * this one.
 */
export function Prose(props: ProseProps): HtmlNode {
  const { class: cls, children, ...rest } = props;
  return jsx("div", {
    ...rest,
    class: cn(
      "text-foreground",
      "[&_h1]:mt-8 [&_h1]:scroll-m-20 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight",
      "[&_h2]:mt-8 [&_h2]:scroll-m-20 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-2 [&_h2]:text-2xl [&_h2]:font-semibold",
      "[&_h3]:mt-6 [&_h3]:scroll-m-20 [&_h3]:text-xl [&_h3]:font-semibold",
      "[&_p]:leading-7 [&_p:not(:first-child)]:mt-4",
      "[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
      "[&_ul]:my-4 [&_ul]:ml-6 [&_ul]:list-disc [&_ol]:my-4 [&_ol]:ml-6 [&_ol]:list-decimal [&_li]:mt-2",
      "[&_blockquote]:mt-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic",
      "[&_code]:rounded [&_code]:bg-muted [&_code]:px-[0.3rem] [&_code]:py-[0.2rem] [&_code]:font-mono [&_code]:text-sm",
      "[&_pre]:mt-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted [&_pre]:p-4",
      // A code block sets its own surface, so the inline-code chip must not
      // apply to the code element inside it.
      "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
      "[&_hr]:my-8 [&_hr]:border-border",
      "[&_table]:w-full [&_table]:text-sm [&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left",
      "[&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-2",
      "[&_img]:rounded-lg",
      cls,
    ),
    children,
  });
}
