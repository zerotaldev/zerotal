import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Head, useForm, usePage } from "@inertiajs/react";
import AppShell from "../Layouts/AppShell";
import PageHeader from "../Components/PageHeader";
import { Card, CardHeader } from "../Components/Card";
import { Button } from "../Components/Button";
import { SelectField, TextField } from "../Components/Field";
import ThemeToggle from "../Components/ThemeToggle";
import { GlobeIcon, ShieldIcon, SunIcon, UserIcon } from "../Components/Icons";
import { cn } from "../lib/cn";
import type { SharedProps } from "../types";
import { endpoint } from "../lib/endpoint";

interface Props {
  title: string;
  locales: { code: string; name: string }[];
  /** Null when this person has never chosen — the request decides instead. */
  locale: string | null;
}

/**
 * Account settings, split by subject.
 *
 * Four panels rather than one long column, because "change my password" and
 * "change my name" are different errands and a reader doing one should not have
 * to scroll past the other. The split is presentational only — there is still a
 * single `/profile` route, and each form still posts where it always did, so
 * nothing here depends on a section existing.
 *
 * Sections are only listed when something behind them works. An empty
 * "Notifications" tab would be a promise the app cannot keep.
 */

const SECTIONS = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "security", label: "Security", icon: ShieldIcon },
  { id: "appearance", label: "Appearance", icon: SunIcon },
  // Its own section rather than a card inside Appearance. Language is not a
  // theme, and nobody hunting for it opens something called "Appearance".
  { id: "language", label: "Language", icon: GlobeIcon },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function Profile({ title, locales, locale }: Props) {
  // `auth.user` is shared into every page by @zerotal/inertia, so this route
  // does not have to pass the signed-in user as a prop.
  const { auth, errors } = usePage<SharedProps>().props;
  const details = useForm({
    name: auth.user?.name ?? "",
    email: auth.user?.email ?? "",
  });

  const password = useForm({
    current_password: "",
    password: "",
    password_confirmation: "",
  });

  /**
   * Open on whichever section the server just complained about.
   *
   * A failed password change redirects back to this route without preserving
   * component state, so without this the page would remount on "Profile" with
   * the errors rendered inside a panel nobody can see — a form that appears to
   * do nothing when submitted.
   */
  const [section, setSection] = useState<SectionId>(() =>
    errors["current_password"] || errors["password"] || errors["password_confirmation"]
      ? "security"
      : "profile",
  );

  function saveDetails(event: FormEvent) {
    event.preventDefault();
    const { url, method } = endpoint("profile.store");
    details.submit(method, url, { preserveScroll: true });
  }

  function changePassword(event: FormEvent) {
    event.preventDefault();
    // Clear the fields whichever way it goes — a failed attempt should not
    // leave the old password sitting in the DOM.
    const { url, method } = endpoint("profile.password.store");
    password.submit(method, url, {
      preserveScroll: true,
      onFinish: () => password.reset(),
    });
  }

  return (
    <>
      <Head title={title} />

      <div className="max-w-4xl space-y-6">
        <PageHeader title={__("Profile")} description={__("Manage your personal information, security and preferences.")} />

        <div className="grid gap-6 md:grid-cols-[180px_minmax(0,1fr)] md:gap-8">
          <SettingsNav active={section} onSelect={setSection} />

          <Panel id="profile" active={section}>
            <Card className="p-5 sm:p-6">
              <CardHeader
                title={__("Personal information")}
                description={__("Update your name and email address.")}
              />

              <form onSubmit={saveDetails} className="mt-5 space-y-5">
                <TextField
                  label={__("Name")}
                  autoComplete="name"
                  value={details.data.name}
                  error={details.errors.name}
                  onChange={(e) => details.setData("name", e.target.value)}
                  required
                />

                <TextField
                  label={__("Email")}
                  type="email"
                  autoComplete="email"
                  value={details.data.email}
                  error={details.errors.email}
                  onChange={(e) => details.setData("email", e.target.value)}
                  required
                />

                <div className="flex justify-end border-t border-border pt-5">
                  <Button type="submit" disabled={details.processing}>
                    {details.processing ? __("Saving…") : __("Save changes")}
                  </Button>
                </div>
              </form>
            </Card>
          </Panel>

          <Panel id="security" active={section}>
            <Card className="p-5 sm:p-6">
              <CardHeader title={__("Password")} description={__("Choose a strong password for your account.")} />

              <form onSubmit={changePassword} className="mt-5 space-y-5">
                <TextField
                  label={__("Current password")}
                  type="password"
                  autoComplete="current-password"
                  value={password.data.current_password}
                  error={password.errors.current_password}
                  onChange={(e) => password.setData("current_password", e.target.value)}
                  required
                />

                <TextField
                  label={__("New password")}
                  type="password"
                  autoComplete="new-password"
                  hint={__("At least 8 characters.")}
                  value={password.data.password}
                  error={password.errors.password}
                  onChange={(e) => password.setData("password", e.target.value)}
                  required
                />

                <TextField
                  label={__("Confirm new password")}
                  type="password"
                  autoComplete="new-password"
                  value={password.data.password_confirmation}
                  error={password.errors.password_confirmation}
                  onChange={(e) => password.setData("password_confirmation", e.target.value)}
                  required
                />

                <div className="flex justify-end border-t border-border pt-5">
                  <Button type="submit" disabled={password.processing}>
                    {password.processing ? __("Updating…") : __("Update password")}
                  </Button>
                </div>
              </form>
            </Card>
          </Panel>

          <Panel id="appearance" active={section}>
            <Card className="p-5 sm:p-6">
              <CardHeader title={__("Theme")} description={__("Light or dark. The choice is stored in this browser.")} />

              <div className="mt-5 flex items-center justify-between gap-4 border-t border-border pt-5">
                <p className="text-sm text-muted-foreground">{__("Switch the interface theme.")}</p>
                <ThemeToggle />
              </div>
            </Card>
          </Panel>

          <Panel id="language" active={section}>
            <LanguageCard locales={locales} current={locale} />
          </Panel>
        </div>
      </div>
    </>
  );
}

/**
 * Choosing a language — feature 12.
 *
 * Submits on change rather than behind a Save button: there is one field, and
 * the confirmation is that the page comes back in the chosen language. A Save
 * button would add a step whose only purpose is to be clicked.
 *
 * The flash that follows is rendered by the server in the new locale, which is
 * the honest test of whether the change took — a toast in the old language
 * would mean the choice was stored and not applied.
 */
function LanguageCard({
  locales,
  current,
}: {
  locales: { code: string; name: string }[];
  current: string | null;
}) {
  const form = useForm({ locale: current ?? locales[0]?.code ?? "en" });

  return (
    <Card className="p-5 sm:p-6">
      <CardHeader title={__("Language")} description={__("Applies to the interface and to messages the server sends you.")} />

      <div className="mt-5 border-t border-border pt-5">
        <SelectField
          label={__("Language")}
          value={form.data.locale}
          error={form.errors.locale}
          disabled={form.processing}
          onChange={(event) => {
            const next = event.target.value;
            form.setData("locale", next);
            // `setData` is queued, so the submit reads the value directly rather
            // than the state it has not been given yet.
            form.transform(() => ({ locale: next }));
            const { url, method } = endpoint("profile.locale.store");
            form.submit(method, url, { preserveScroll: true });
          }}
        >
          {locales.map((locale) => (
            <option key={locale.code} value={locale.code}>
              {locale.name}
            </option>
          ))}
        </SelectField>
      </div>
    </Card>
  );
}

/**
 * The section switcher — a real tab list.
 *
 * Vertical beside the panels on a wide screen and a scrolling row above them on
 * a narrow one, but the same control and the same roles either way, so the
 * arrow keys behave the same at every width.
 */
function SettingsNav({
  active,
  onSelect,
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();

    const index = SECTIONS.findIndex((section) => section.id === active);
    const next = SECTIONS[(index + step + SECTIONS.length) % SECTIONS.length]!;

    onSelect(next.id);
    document.getElementById(`settings-tab-${next.id}`)?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={__("Settings sections")}
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0"
    >
      {SECTIONS.map((section) => {
        const selected = section.id === active;
        const Icon = section.icon;

        return (
          <button
            key={section.id}
            id={`settings-tab-${section.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`settings-panel-${section.id}`}
            // Only the selected tab is in the tab order; the arrows move between
            // them from there. Tab should step past the group, not through it.
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(section.id)}
            className={cn(
              "flex h-9 shrink-0 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors duration-150",
              selected
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className={cn("size-4 shrink-0", selected ? "text-primary" : "text-current")} />
            {__(section.label)}
          </button>
        );
      })}
    </div>
  );
}

/** One settings panel, shown only while its tab is the selected one. */
function Panel({
  id,
  active,
  children,
}: {
  id: SectionId;
  active: SectionId;
  children: ReactNode;
}) {
  if (id !== active) return null;

  return (
    <div
      id={`settings-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`settings-tab-${id}`}
      tabIndex={0}
      className="md:col-start-2"
    >
      {children}
    </div>
  );
}

Profile.layout = (page: ReactNode) => <AppShell>{page}</AppShell>;

export default Profile;
