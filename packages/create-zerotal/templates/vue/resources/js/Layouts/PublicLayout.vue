<script setup lang="ts">
/**
 * The public site's shell — decorative backdrop, sticky header with active-aware
 * navigation, and a footer. The marketing pages and the error page use it; signed-in
 * pages use AppLayout, and the sign-in screens AuthLayout.
 *
 * Use it as an Inertia persistent layout so the header survives client-side
 * navigations and only the page body re-renders — in a page's script setup:
 *   defineOptions({ layout: PublicLayout });
 *
 * Header, content and footer all share the same `max-w-5xl px-6` container, so
 * the nav and the page body line up at every breakpoint.
 */
import { computed, ref, watch } from "vue";
import { Link, usePage } from "@inertiajs/vue3";
import Toasts from "../Components/Toasts.vue";
import Button from "../Components/Button.vue";
import ThemeToggle from "../Components/ThemeToggle.vue";
import Icon from "../Components/Icon.vue";
import { DOCS_URL, useAppName } from "../lib/site";
import { cn } from "../lib/cn";
import type { SharedProps } from "../types";

// No "Home" entry: the logo is the link home.
const NAV = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

const CONTAINER = "mx-auto w-full max-w-5xl px-6";

const page = usePage<SharedProps>();
const url = computed(() => page.url);
const signedIn = computed(() => Boolean(page.props.auth?.user));
const appName = useAppName();
const navItems = NAV;

const menuOpen = ref(false);

// Close the mobile menu once a visit lands, otherwise it stays open on top of
// the page the user just navigated to.
watch(url, () => (menuOpen.value = false));

const isActive = (href: string): boolean =>
  url.value.startsWith(href);

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
          :href="route('home')"
          class="flex min-w-0 items-center gap-2.5 font-semibold tracking-tight"
          :aria-label="`${appName} home`"
        >
          <img src="/zt.svg" alt="" class="size-8 shrink-0 rounded-lg" />
          <span class="truncate">{{ appName }}</span>
        </Link>

        <!-- Everything but the logo sits on the right: the site's pages, then the actions. -->
        <div class="flex items-center gap-2">
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
          <span aria-hidden="true" class="mx-1 hidden h-5 w-px bg-border sm:block" />
          <a
            :href="DOCS_URL"
            target="_blank"
            rel="noreferrer"
            class="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:block"
          >
            Docs
          </a>
          <ThemeToggle />
          <!-- The next useful step, rather than a link that would bounce them. -->
          <Button
            v-if="signedIn"
            :href="route('dashboard')"
            size="sm"
            class="hidden sm:inline-flex"
          >
            Dashboard
          </Button>
          <template v-else>
            <Link
              :href="route('login')"
              class="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:block"
            >
              Sign in
            </Link>
            <Button :href="route('register')" size="sm" class="hidden sm:inline-flex">
              Get started
            </Button>
          </template>
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
        <Link v-if="signedIn" :href="route('dashboard')" :class="navLink('/dashboard')">
          Dashboard
        </Link>
        <template v-else>
          <Link :href="route('login')" :class="navLink('/login')">Sign in</Link>
          <Link :href="route('register')" :class="navLink('/register')">Get started</Link>
        </template>
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

    <Toasts />
  </div>
</template>
