<script setup lang="ts">
/**
 * Shared application shell — decorative backdrop, sticky header with
 * active-aware navigation, and a footer.
 *
 * Use it as an Inertia persistent layout so the header survives client-side
 * navigations and only the page body re-renders — in a page's script setup:
 *   defineOptions({ layout: AppLayout });
 *
 * Header, content and footer all share the same `max-w-5xl px-6` container, so
 * the nav and the page body line up at every breakpoint.
 */
import { computed, ref, watch } from "vue";
import { Link, usePage } from "@inertiajs/vue3";
import FlashToasts from "../Components/FlashToasts.vue";
import ThemeToggle from "../Components/ThemeToggle.vue";
import Icon from "../Components/Icon.vue";
import { APP_NAME, DOCS_URL } from "../lib/site";
import { cn } from "../lib/cn";
import type { SharedProps } from "../types";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

// Shown to signed-in visitors and guests respectively, so the header always
// offers the next useful step rather than a link that would bounce them.
const AUTHED_NAV = [{ href: "/profile", label: "Profile" }];
const GUEST_NAV = [
  { href: "/login", label: "Sign in" },
  { href: "/register", label: "Register" },
];

const CONTAINER = "mx-auto w-full max-w-5xl px-6";

const page = usePage<SharedProps>();
const url = computed(() => page.url);
const signedIn = computed(() => Boolean(page.props.auth?.user));
const navItems = computed(() => [...NAV, ...(signedIn.value ? AUTHED_NAV : GUEST_NAV)]);

const menuOpen = ref(false);

// Close the mobile menu once a visit lands, otherwise it stays open on top of
// the page the user just navigated to.
watch(url, () => (menuOpen.value = false));

const isActive = (href: string): boolean =>
  href === "/" ? url.value === "/" : url.value.startsWith(href);

const navLink = (href: string): string =>
  cn(
    "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    isActive(href)
      ? "bg-accent text-accent-foreground"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
</script>

<template>
  <div class="relative flex min-h-dvh flex-col">
    <!-- Decorative only: the grid and the glow. Fixed, inert, and behind everything. -->
    <div aria-hidden="true" class="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div class="absolute inset-0 bg-grid" />
      <div class="absolute inset-x-0 top-0 h-136 bg-aurora" />
    </div>

    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
    >
      Skip to content
    </a>

    <header class="sticky top-0 z-40 border-b border-border bg-background/75 backdrop-blur-md">
      <div :class="cn(CONTAINER, 'flex h-16 items-center justify-between gap-4')">
        <Link
          href="/"
          class="flex min-w-0 items-center gap-2.5 font-semibold tracking-tight"
          :aria-label="`${APP_NAME} home`"
        >
          <img src="/zt.svg" alt="" class="size-8 shrink-0 rounded-lg" />
          <span class="truncate">{{ APP_NAME }}</span>
        </Link>

        <nav aria-label="Main" class="hidden items-center gap-1 sm:flex">
          <Link
            v-for="item in navItems"
            :key="item.href"
            :href="item.href"
            :aria-current="isActive(item.href) ? 'page' : undefined"
            :class="navLink(item.href)"
          >
            {{ item.label }}
          </Link>
        </nav>

        <div class="flex items-center gap-2">
          <a
            :href="DOCS_URL"
            target="_blank"
            rel="noreferrer"
            class="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:block"
          >
            Docs
          </a>
          <ThemeToggle />
          <button
            type="button"
            :aria-expanded="menuOpen"
            aria-controls="mobile-nav"
            :aria-label="menuOpen ? 'Close menu' : 'Open menu'"
            class="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:hidden"
            @click="menuOpen = !menuOpen"
          >
            <Icon :name="menuOpen ? 'close' : 'menu'" class="size-4.5" />
          </button>
        </div>
      </div>

      <nav
        v-if="menuOpen"
        id="mobile-nav"
        aria-label="Main"
        :class="cn(CONTAINER, 'flex flex-col gap-1 border-t border-border py-3 sm:hidden')"
      >
        <Link
          v-for="item in navItems"
          :key="item.href"
          :href="item.href"
          :aria-current="isActive(item.href) ? 'page' : undefined"
          :class="navLink(item.href)"
        >
          {{ item.label }}
        </Link>
        <a
          :href="DOCS_URL"
          target="_blank"
          rel="noreferrer"
          class="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Docs
        </a>
      </nav>
    </header>

    <main id="main" :class="cn(CONTAINER, 'flex-1 py-14 sm:py-20')">
      <slot />
    </main>

    <footer class="border-t border-border">
      <div
        :class="
          cn(
            CONTAINER,
            'flex flex-col items-center justify-between gap-3 py-8 text-sm text-muted-foreground sm:flex-row',
          )
        "
      >
        <p>
          Built with <span class="font-medium text-foreground">Zerotal</span> — the Bun-native
          TypeScript framework.
        </p>
        <a
          :href="DOCS_URL"
          target="_blank"
          rel="noreferrer"
          class="font-medium transition-colors hover:text-foreground"
        >
          Documentation
        </a>
      </div>
    </footer>

    <FlashToasts />
  </div>
</template>
