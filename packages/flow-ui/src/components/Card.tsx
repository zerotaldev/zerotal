/** @jsxImportSource @zerotal/flow */
// ── <Card> ──────────────────────────────────────────────────────────────────
//
// A surface container and its sub-parts. Pure leaf
// components: each renders a themed element and forwards `class` (merged last via
// cn) plus any other attrs. Compose them:
//
//   <Card>
//     <CardHeader>
//       <CardTitle>Team</CardTitle>
//       <CardDescription>Manage your members.</CardDescription>
//     </CardHeader>
//     <CardContent>…</CardContent>
//     <CardFooter><Button>Save</Button></CardFooter>
//   </Card>

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface CardElementProps {
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function Card(props: CardElementProps): HtmlNode {
  const { class: cls, children, ...rest } = props;
  return (
    <div class={cn("rounded-xl border bg-card text-card-foreground shadow", cls)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader(props: CardElementProps): HtmlNode {
  const { class: cls, children, ...rest } = props;
  return (
    <div class={cn("flex flex-col space-y-1.5 p-6", cls)} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle(props: CardElementProps): HtmlNode {
  const { class: cls, children, ...rest } = props;
  return (
    <h3 class={cn("font-semibold leading-none tracking-tight", cls)} {...rest}>
      {children}
    </h3>
  );
}

export function CardDescription(props: CardElementProps): HtmlNode {
  const { class: cls, children, ...rest } = props;
  return (
    <p class={cn("text-sm text-muted-foreground", cls)} {...rest}>
      {children}
    </p>
  );
}

export function CardContent(props: CardElementProps): HtmlNode {
  const { class: cls, children, ...rest } = props;
  return (
    <div class={cn("p-6 pt-0", cls)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter(props: CardElementProps): HtmlNode {
  const { class: cls, children, ...rest } = props;
  return (
    <div class={cn("flex items-center p-6 pt-0", cls)} {...rest}>
      {children}
    </div>
  );
}
