<script setup lang="ts">
/**
 * "Showing 11–20 of 42", with previous / next. `href` builds the URL for a page, so the
 * list keeps its other query parameters (a search, a filter) as the user pages through.
 */
import { Link } from "@inertiajs/vue3";
import Icon from "./Icon.vue";
import type { Pagination } from "../types";

withDefaults(
  defineProps<{
    pagination: Pagination;
    href: (page: number) => string;
    noun?: string | undefined;
  }>(),
  { noun: "results" },
);

const LINK =
  "inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium transition-colors";
</script>

<template>
  <nav
    v-if="pagination.total > 0"
    aria-label="Pagination"
    class="flex items-center justify-between gap-4"
  >
    <p class="text-sm text-muted-foreground">
      Showing <span class="font-medium text-foreground">{{ pagination.from }}</span>–<span
        class="font-medium text-foreground"
        >{{ pagination.to }}</span
      >
      of <span class="font-medium text-foreground">{{ pagination.total }}</span> {{ noun }}
    </p>
    <div v-if="pagination.lastPage > 1" class="flex gap-2">
      <span
        v-if="pagination.page <= 1"
        aria-disabled="true"
        :class="[LINK, 'pointer-events-none opacity-50']"
      >
        <Icon name="chevron-left" class="size-4" /> Previous
      </span>
      <Link
        v-else
        :href="href(pagination.page - 1)"
        preserve-scroll
        rel="prev"
        :class="[LINK, 'bg-card hover:bg-muted']"
      >
        <Icon name="chevron-left" class="size-4" /> Previous
      </Link>
      <span
        v-if="pagination.page >= pagination.lastPage"
        aria-disabled="true"
        :class="[LINK, 'pointer-events-none opacity-50']"
      >
        Next <Icon name="chevron-right" class="size-4" />
      </span>
      <Link
        v-else
        :href="href(pagination.page + 1)"
        preserve-scroll
        rel="next"
        :class="[LINK, 'bg-card hover:bg-muted']"
      >
        Next <Icon name="chevron-right" class="size-4" />
      </Link>
    </div>
  </nav>
</template>
