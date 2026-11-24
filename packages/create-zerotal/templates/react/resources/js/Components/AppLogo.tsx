import { cn } from "../lib/cn";
import { useAppName } from "../lib/site";

/** The logo mark and the app's name, as config/app.ts sets it. */
export function AppLogo({ className, hideName = false }: { className?: string; hideName?: boolean }) {
  const name = useAppName();
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5 font-semibold tracking-tight", className)}>
      <img src="/zt.svg" alt="" className="size-8 shrink-0 rounded-lg" />
      {hideName ? <span className="sr-only">{name}</span> : <span className="truncate">{name}</span>}
    </span>
  );
}
