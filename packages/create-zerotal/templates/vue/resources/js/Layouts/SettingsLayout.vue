<script setup lang="ts">
/**
 * Settings: a list of sections beside the page on wide screens, a scrolling row of tabs
 * above it on narrow ones. Renders inside AppLayout — in a settings page's script setup:
 *
 *   defineOptions({ layout: SettingsLayout });
 */
import { computed } from "vue";
import { Link, usePage } from "@inertiajs/vue3";
import AppLayout from "./AppLayout.vue";
import Icon from "../Components/Icon.vue";
import PageHeader from "../Components/PageHeader.vue";
import { cn } from "../lib/cn";
import type { IconName } from "../lib/icons";
import type { SharedProps } from "../types";

const page = usePage<SharedProps>();
const path = computed(() => page.url.split("?")[0] ?? page.url);

const sections = computed<{ label: string; href: string; icon: IconName }[]>(() => [
  { label: "Profile", href: "/settings/profile", icon: "user" },
  { label: "Password", href: "/settings/password", icon: "lock" },
  { label: "Appearance", href: "/settings/appearance", icon: "palette" },
  { label: "Two-factor", href: "/settings/two-factor", icon: "shield" },
  // Only when PASSKEY_RP_ID is set; the routes are 404s otherwise.
  ...(page.props.features?.passkeys
    ? [{ label: "Passkeys", href: "/settings/passkeys", icon: "fingerprint" as const }]
    : []),
  { label: "Sessions", href: "/settings/sessions", icon: "monitor" },
  { label: "Delete account", href: "/settings/delete-account", icon: "trash" },
]);

const linkClass = (href: string) =>
  cn(
    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
    path.value === href
      ? "bg-accent text-accent-foreground"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
</script>

<template>
  <AppLayout>
    <PageHeader title="Settings" description="Manage your account and how you sign in." />

    <div class="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <nav
        aria-label="Settings"
        class="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:w-52 lg:shrink-0 lg:px-0"
      >
        <ul class="flex gap-1 lg:flex-col">
          <li v-for="section in sections" :key="section.href" class="shrink-0">
            <Link
              :href="section.href"
              :aria-current="path === section.href ? 'page' : undefined"
              :class="linkClass(section.href)"
            >
              <Icon :name="section.icon" class="size-4 shrink-0" />
              {{ section.label }}
            </Link>
          </li>
        </ul>
      </nav>

      <div class="min-w-0 flex-1 space-y-6 lg:max-w-2xl"><slot /></div>
    </div>
  </AppLayout>
</template>
