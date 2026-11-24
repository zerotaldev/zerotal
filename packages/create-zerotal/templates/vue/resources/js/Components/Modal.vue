<script setup lang="ts">
/**
 * A dialog over the page, built on the native `<dialog>` element.
 *
 * `showModal()` gives the parts that are easy to get wrong for free: focus moves into the
 * dialog and is kept there, the rest of the page is inert to the keyboard and to screen
 * readers, and Escape closes it. Clicking the backdrop closes it too.
 *
 * Controlled: render it with `:open` and handle `@close`. Buttons go in the `footer` slot.
 */
import { onMounted, ref, useId, watch } from "vue";
import Icon from "./Icon.vue";

const props = defineProps<{ open: boolean; title: string; description?: string | undefined }>();
const emit = defineEmits<{ close: [] }>();

const dialog = ref<HTMLDialogElement | null>(null);
const titleId = useId();
const descriptionId = useId();

function sync() {
  const el = dialog.value;
  if (!el) return;
  if (props.open && !el.open) el.showModal();
  if (!props.open && el.open) el.close();
}

onMounted(sync);
watch(() => props.open, sync);

// A click whose target is the dialog itself landed on the backdrop.
function onClick(event: MouseEvent) {
  if (event.target === dialog.value) emit("close");
}
</script>

<template>
  <dialog
    ref="dialog"
    :aria-labelledby="titleId"
    :aria-describedby="description ? descriptionId : undefined"
    class="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    @cancel.prevent="emit('close')"
    @click="onClick"
  >
    <div class="p-5 sm:p-6">
      <div class="flex items-start justify-between gap-4">
        <h2 :id="titleId" class="text-lg font-semibold">{{ title }}</h2>
        <button
          type="button"
          aria-label="Close"
          class="-m-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="emit('close')"
        >
          <Icon name="close" class="size-4.5" />
        </button>
      </div>
      <p v-if="description" :id="descriptionId" class="mt-1.5 text-sm text-muted-foreground">
        {{ description }}
      </p>
      <div v-if="$slots.default" class="mt-5"><slot /></div>
    </div>
    <div
      v-if="$slots.footer"
      class="flex flex-col-reverse gap-2 rounded-b-2xl border-t border-border bg-muted/40 px-5 py-3 sm:flex-row sm:justify-end sm:px-6"
    >
      <slot name="footer" />
    </div>
  </dialog>
</template>
