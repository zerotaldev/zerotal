import { buttonClass } from "./Button";
import { GitHubIcon, GoogleIcon } from "./Icon";

const PROVIDERS: Record<string, { label: string; icon: typeof GitHubIcon }> = {
  github: { label: "GitHub", icon: GitHubIcon },
  google: { label: "Google", icon: GoogleIcon },
};

/**
 * "Continue with GitHub / Google", for the providers config/social.ts has switched on.
 * Plain links rather than Inertia visits: they leave the app for the provider's site.
 */
export function SocialButtons({ providers }: { providers: string[] }) {
  const available = providers.filter((name) => name in PROVIDERS);
  if (available.length === 0) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {available.map((name) => {
        const { label, icon: Icon } = PROVIDERS[name]!;
        return (
          <a key={name} href={`/auth/${name}`} className={buttonClass("secondary", "md", "w-full")}>
            <Icon className="size-4" />
            {label}
          </a>
        );
      })}
    </div>
  );
}

/** The "or" rule between one way of signing in and another. */
export function Divider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-xs tracking-wide text-muted-foreground uppercase">
      <span className="h-px flex-1 bg-border" />
      {label}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
