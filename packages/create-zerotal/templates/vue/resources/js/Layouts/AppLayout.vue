<script setup lang="ts">
/**
 * The signed-in shell: a sidebar on wide screens, a top bar with a slide-out menu on
 * narrow ones. Every page behind sign-in renders inside it — in a page's script setup:
 *
 *   defineOptions({ layout: AppLayout });
 *
 * The sidebar's sections are listed in Components/AppSidebar.vue.
 */
import { computed, ref, watch } from "vue";
import { Link, usePage } from "@inertiajs/vue3";
import AppLogo from "../Components/AppLogo.vue";
import AppSidebar from "../Components/AppSidebar.vue";
import Avatar from "../Components/Avatar.vue";
import Dropdown from "../Components/Dropdown.vue";
import Icon from "../Components/Icon.vue";
import Toasts from "../Components/Toasts.vue";
import type { DropdownItem, SharedProps } from "../types";

const page = usePage<SharedProps>();
const user = computed(() => page.props.auth.user);

const menuItems = computed<DropdownItem[]>(() => [
  { label: "Settings", href: "/settings", icon: "settings" },
  { label: "Sign out", href: route("logout.store"), method: "post", icon: "log-out" },
]);

// The mobile menu is a modal <dialog>: focus moves into it, the page behind is inert,
// and Escape closes it.
const menuOpen = ref(false);
const drawer = ref<HTMLDialogElement | null>(null);
watch(menuOpen, (open) => {
  const dialog = drawer.value;
  if (!dialog) return;
  if (open && !dialog.open) dialog.showModal();
  if (!open && dialog.open) dialog.close();
});
// Close it once a visit lands, so it is not left open over the new page.
watch(
  () => page.url,
  () => (menuOpen.value = false),
);

function onDrawerClick(event: MouseEvent) {
  if (event.target === drawer.value) menuOpen.value = false;
}
</script>

<template>
  <div class="min-h-dvh lg:pl-64">
    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-lg focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
    >
      Skip to content
    </a>

    <!-- Wide screens: a fixed sidebar. -->
    <aside
      class="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-card/60 backdrop-blur lg:block"
    >
      <AppSidebar />
    </aside>

    <!-- Narrow screens: a top bar, and the same sidebar in a drawer. -->
    <header
      class="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md lg:hidden"
    >
      <button
        type="button"
        aria-label="Open menu"
        :aria-expanded="menuOpen"
        class="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click="menuOpen = true"
      >
        <Icon name="menu" class="size-4.5" />
      </button>
      <Link :href="route('dashboard')" class="min-w-0 flex-1 rounded-lg"><AppLogo /></Link>
      <Dropdown v-if="user" label="Account" :items="menuItems">
        <template #header>
          <p class="truncate text-sm font-medium">{{ user.name }}</p>
          <p class="truncate text-xs text-muted-foreground">{{ user.email }}</p>
        </template>
        <template #trigger><Avatar :name="user.name" /></template>
      </Dropdown>
    </header>

    <dialog
      ref="drawer"
      aria-label="Menu"
      class="m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r border-border bg-card p-0 text-card-foreground backdrop:bg-black/50 lg:hidden"
      @cancel.prevent="menuOpen = false"
      @click="onDrawerClick"
    >
      <AppSidebar closable @close="menuOpen = false" />
    </dialog>

    <main id="main" class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <slot />
    </main>

    <Toasts />
  </div>
</template>
