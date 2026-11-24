<script setup lang="ts">
/**
 * A menu behind a button, usable from the keyboard: Enter, Space or Arrow Down opens it
 * on the first item, the arrows and Home/End move between items, Escape closes it and
 * returns focus to the button, and Tab leaves it.
 *
 * The button's content goes in the `trigger` slot, and anything non-interactive above
 * the items (the signed-in user's name) in `header`.
 */
import { nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { Link } from "@inertiajs/vue3";
import Icon from "./Icon.vue";
import type { DropdownItem } from "../types";
import { cn } from "../lib/cn";

const props = withDefaults(
  defineProps<{
    items: DropdownItem[];
    /** The button's accessible name, when the trigger is not text. */
    label?: string | undefined;
    align?: "start" | "end" | undefined;
    side?: "top" | "bottom" | undefined;
  }>(),
  { align: "end", side: "bottom" },
);

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const button = ref<HTMLButtonElement | null>(null);
const menuId = useId();

const menuItems = () =>
  Array.from(root.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

function focusItem(index: number) {
  const all = menuItems();
  if (all.length === 0) return;
  all[(index + all.length) % all.length]?.focus();
}

async function openOn(index: number) {
  open.value = true;
  await nextTick();
  focusItem(index);
}

function close(returnFocus: boolean) {
  open.value = false;
  if (returnFocus) button.value?.focus();
}

function onButtonKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    void openOn(0);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    void openOn(-1);
  }
}

function onMenuKeydown(event: KeyboardEvent) {
  const current = menuItems().indexOf(document.activeElement as HTMLElement);
  const moves: Record<string, () => void> = {
    ArrowDown: () => focusItem(current + 1),
    ArrowUp: () => focusItem(current - 1),
    Home: () => focusItem(0),
    End: () => focusItem(-1),
    Escape: () => close(true),
  };
  if (event.key === "Tab") return close(false);
  const move = moves[event.key];
  if (move) {
    event.preventDefault();
    move();
  }
}

// Close on a click anywhere else.
function onPointerDown(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) open.value = false;
}
watch(open, (isOpen) => {
  if (isOpen) document.addEventListener("pointerdown", onPointerDown);
  else document.removeEventListener("pointerdown", onPointerDown);
});
onBeforeUnmount(() => document.removeEventListener("pointerdown", onPointerDown));

function select(item: DropdownItem) {
  close(true);
  item.onSelect?.();
}

const itemClass = (danger?: boolean) =>
  cn(
    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors",
    "focus-visible:bg-muted hover:bg-muted",
    danger ? "text-destructive" : "text-foreground",
  );

const menuClass = () =>
  cn(
    "absolute z-50 min-w-56 rounded-xl border border-border bg-card p-1.5 shadow-xl",
    props.align === "end" ? "right-0" : "left-0",
    props.side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
  );
</script>

<template>
  <div ref="root" class="relative">
    <button
      ref="button"
      type="button"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      :aria-label="label"
      class="w-full rounded-lg"
      @click="open ? close(false) : (open = true)"
      @keydown="onButtonKeydown"
    >
      <slot name="trigger" />
    </button>

    <div
      v-if="open"
      :id="menuId"
      role="menu"
      :aria-label="label"
      :class="menuClass()"
      @keydown="onMenuKeydown"
    >
      <div v-if="$slots.header" class="mb-1.5 border-b border-border px-2.5 pt-1.5 pb-2.5">
        <slot name="header" />
      </div>
      <template v-for="item in items" :key="item.label">
        <Link
          v-if="item.href"
          :href="item.href"
          v-bind="item.method ? { method: item.method, as: 'button' } : {}"
          role="menuitem"
          tabindex="-1"
          :class="itemClass(item.danger)"
          @click="close(false)"
        >
          <Icon v-if="item.icon" :name="item.icon" class="size-4 shrink-0 opacity-70" />
          {{ item.label }}
        </Link>
        <button
          v-else
          type="button"
          role="menuitem"
          tabindex="-1"
          :class="itemClass(item.danger)"
          @click="select(item)"
        >
          <Icon v-if="item.icon" :name="item.icon" class="size-4 shrink-0 opacity-70" />
          {{ item.label }}
        </button>
      </template>
    </div>
  </div>
</template>
