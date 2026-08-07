<script setup lang="ts">
/**
 * Light/dark switch.
 *
 * The class on `<html>` is the single source of truth — every colour is a CSS
 * custom property that `.dark` redefines, so flipping the class re-themes the
 * page with no re-render and no `dark:` variants through the components. The
 * choice is persisted under the same key the no-flash script in
 * resources/app.html reads on boot, so an app and its admin panel agree.
 */
import { ref } from "vue";
import Icon from "./Icon.vue";

const STORAGE_KEY = "zerotal-theme";

function isDark(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

const dark = ref(isDark());

function toggle(): void {
  const next = !isDark();
  document.documentElement.classList.toggle("dark", next);
  try {
    localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
  } catch {
    // Storage can be unavailable (private mode). The class is still applied,
    // the choice just won't survive a reload.
  }
  dark.value = next;
}
</script>

<template>
  <button
    type="button"
    :aria-pressed="dark"
    :aria-label="dark ? 'Switch to light theme' : 'Switch to dark theme'"
    :title="dark ? 'Switch to light theme' : 'Switch to dark theme'"
    class="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    @click="toggle"
  >
    <Icon :name="dark ? 'moon' : 'sun'" class="size-4.5" />
  </button>
</template>
