import { Dropdown } from "./Dropdown";
import { LaptopIcon, MoonIcon, SunIcon } from "./Icon";
import { useAppearance, type Appearance } from "../lib/theme";
import { cn } from "../lib/cn";

const ICON: Record<Appearance, typeof SunIcon> = {
  light: SunIcon,
  dark: MoonIcon,
  system: LaptopIcon,
};

/**
 * Light / dark / system, from a small menu. Settings → Appearance offers the same three;
 * both read and write the same stored choice (resources/js/lib/theme.ts).
 */
export default function ThemeToggle({ className }: { className?: string }) {
  const [appearance, setAppearance] = useAppearance();
  const Icon = ICON[appearance];

  return (
    <Dropdown
      className={className}
      label="Theme"
      trigger={
        <span
          className={cn(
            "grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          )}
        >
          <Icon className="size-4.5" />
        </span>
      }
      items={(["light", "dark", "system"] as const).map((option) => ({
        label: option === "system" ? "System" : option === "light" ? "Light" : "Dark",
        icon: ICON[option],
        onSelect: () => setAppearance(option),
      }))}
    />
  );
}
