<script setup lang="ts">
/**
 * The signed-in navigation: logo, the app's sections, settings and docs, and the
 * account menu. AppLayout shows it fixed beside the page on wide screens and in a
 * slide-out drawer on narrow ones.
 *
 * Add a section of the app by adding a line to `NAV`.
 */
import { computed } from "vue";
import { Link, usePage } from "@inertiajs/vue3";
import AppLogo from "./AppLogo.vue";
import Avatar from "./Avatar.vue";
import Dropdown from "./Dropdown.vue";
import Icon from "./Icon.vue";
import ThemeToggle from "./ThemeToggle.vue";
import { cn } from "../lib/cn";
import type { IconName } from "../lib/icons";
import { DOCS_URL } from "../lib/site";
import type { DropdownItem, SharedProps } from "../types";

/** `closable` adds a close button, for the drawer. */
withDefaults(defineProps<{ closable?: boolean | undefined }>(), { closable: false });
const emit = defineEmits<{ close: [] }>();

interface NavItem {
  label: string;
  href: string;
  icon: IconName;
}

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "grid" },
  { label: "Projects", href: "/projects", icon: "folder" },
];
const SETTINGS: NavItem = { label: "Settings", href: "/settings", icon: "settings" };

const page = usePage<SharedProps>();
const user = computed(() => page.props.auth.user);
const path = computed(() => page.url.split("?")[0] ?? page.url);

const isActive = (href: string) => path.value === href || path.value.startsWith(`${href}/`);
const navLink = (href: string) =>
  cn(
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    isActive(href)
      ? "bg-accent text-accent-foreground"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );

const menuItems = computed<DropdownItem[]>(() => [
  { label: "Settings", href: "/settings", icon: "settings" },
  { label: "Sign out", href: route("logout.store"), method: "post", icon: "log-out" },
]);
</script>

<template>
  <div class="flex h-full flex-col gap-6 p-4">
    <div class="flex items-center justify-between gap-2 px-2 pt-1">
      <Link :href="route('dashboard')" class="min-w-0 rounded-lg"><AppLogo /></Link>
      <div class="flex items-center gap-2">
        <ThemeToggle />
        <button
          v-if="closable"
          type="button"
          aria-label="Close menu"
          class="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="emit('close')"
        >
          <Icon name="close" class="size-4.5" />
        </button>
      </div>
    </div>

    <nav aria-label="Main" class="flex flex-1 flex-col gap-1">
      <Link
        v-for="item in NAV"
        :key="item.href"
        :href="item.href"
        :aria-current="isActive(item.href) ? 'page' : undefined"
        :class="navLink(item.href)"
      >
        <Icon :name="item.icon" class="size-4.5 shrink-0" />
        {{ item.label }}
      </Link>
      <div class="mt-auto flex flex-col gap-1 pt-6">
        <Link
          :href="SETTINGS.href"
          :aria-current="isActive(SETTINGS.href) ? 'page' : undefined"
          :class="navLink(SETTINGS.href)"
        >
          <Icon :name="SETTINGS.icon" class="size-4.5 shrink-0" />
          {{ SETTINGS.label }}
        </Link>
        <a
          :href="DOCS_URL"
          target="_blank"
          rel="noreferrer"
          class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Icon name="external-link" class="size-4.5 shrink-0" />
          Documentation
        </a>
      </div>
    </nav>

    <div v-if="user" class="border-t border-border pt-4">
      <Dropdown label="Account" side="top" align="start" :items="menuItems">
        <template #header>
          <p class="truncate text-sm font-medium">{{ user.name }}</p>
          <p class="truncate text-xs text-muted-foreground">{{ user.email }}</p>
        </template>
        <template #trigger>
          <span
            class="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted"
          >
            <Avatar :name="user.name" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{{ user.name }}</span>
              <span class="block truncate text-xs text-muted-foreground">{{ user.email }}</span>
            </span>
            <Icon name="chevron-down" class="size-4 shrink-0 text-muted-foreground" />
          </span>
        </template>
      </Dropdown>
    </div>
  </div>
</template>
