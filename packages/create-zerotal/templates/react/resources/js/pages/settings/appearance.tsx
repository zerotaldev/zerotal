import type { ReactNode } from "react";
import { Head } from "@inertiajs/react";
import SettingsLayout from "../../Layouts/SettingsLayout";
import { Card, CardBody, CardHeader } from "../../Components/Card";
import { LaptopIcon, MoonIcon, SunIcon } from "../../Components/Icons";
import { cn } from "../../lib/cn";
import { useAppearance, type Appearance as Choice } from "../../lib/theme";

interface Props {
  title: string;
}

const OPTIONS: { value: Choice; label: string; description: string; icon: typeof SunIcon }[] = [
  { value: "light", label: "Light", description: "Always light.", icon: SunIcon },
  { value: "dark", label: "Dark", description: "Always dark.", icon: MoonIcon },
  { value: "system", label: "System", description: "Match this device.", icon: LaptopIcon },
];

function Appearance({ title }: Props) {
  const [appearance, setAppearance] = useAppearance();

  return (
    <>
      <Head title={title} />

      <Card>
        <CardHeader
          title="Appearance"
          description="Kept in this browser, so each of your devices can have its own."
        />
        <CardBody>
          <fieldset>
            <legend className="sr-only">Theme</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {OPTIONS.map((option) => {
                const Icon = option.icon;
                const checked = appearance === option.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      "flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                      checked ? "border-primary bg-accent" : "border-border hover:bg-muted",
                    )}
                  >
                    <input
                      type="radio"
                      name="appearance"
                      value={option.value}
                      checked={checked}
                      onChange={() => setAppearance(option.value)}
                      className="sr-only"
                    />
                    <Icon
                      className={cn("size-5", checked ? "text-primary" : "text-muted-foreground")}
                    />
                    <span>
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className="block text-sm text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </CardBody>
      </Card>
    </>
  );
}

Appearance.layout = (page: ReactNode) => <SettingsLayout>{page}</SettingsLayout>;

export default Appearance;
