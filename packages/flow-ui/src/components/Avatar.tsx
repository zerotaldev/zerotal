/** @jsxImportSource @zerotal/flow */
// ── <Avatar> ────────────────────────────────────────────────────────────────
//
// A circular avatar with an image and a fallback. Since Flow renders on the
// server (no client-side image-load fallback), pass an `src` to render the image
// and `fallback` text (e.g. initials) shown when `src` is absent.
//
//   <Avatar src={user.avatarUrl} alt={user.name} fallback="AL" />
//   <Avatar fallback="GH" />

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface AvatarProps {
  src?: string | null;
  alt?: string;
  fallback?: unknown;
  class?: string;
  imageClass?: string;
  fallbackClass?: string;
  [key: string]: unknown;
}

export function Avatar(props: AvatarProps): HtmlNode {
  const {
    src,
    alt = "",
    fallback,
    class: cls,
    imageClass,
    fallbackClass,
    children: _ignore,
    ...rest
  } = props as AvatarProps & { children?: unknown };

  const inner = src ? (
    <img src={src} alt={alt} class={cn("aspect-square h-full w-full object-cover", imageClass)} />
  ) : (
    <span
      class={cn(
        "flex h-full w-full items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground",
        fallbackClass,
      )}
    >
      {fallback}
    </span>
  );

  return (
    <span
      class={cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", cls)}
      {...rest}
    >
      {inner}
    </span>
  );
}
