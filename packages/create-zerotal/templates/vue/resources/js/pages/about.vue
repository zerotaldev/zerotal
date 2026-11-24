<script setup lang="ts">
import { Head } from "@inertiajs/vue3";
import PublicLayout from "../Layouts/PublicLayout.vue";
import Button from "../Components/Button.vue";
import Card from "../Components/Card.vue";
import Code from "../Components/Code.vue";
import Icon from "../Components/Icon.vue";

defineOptions({ layout: PublicLayout });

defineProps<{
  title: string;
}>();

/** Prose with inline code chips: plain strings, and `{ code }` for each chip. */
type Rich = (string | { code: string })[];

/** The trip this very page made, from URL to rendered page. */
const LIFECYCLE: { where: string; what: Rich }[] = [
  {
    where: "app/routes/about.ts",
    what: [
      "The URL ",
      { code: "/about" },
      " is this file's path. Its exported ",
      { code: "GET" },
      " function runs on the server.",
    ],
  },
  {
    where: 'Inertia.render("about", props)',
    what: [
      "Names the page component and hands it data. On a first load the server returns HTML; on every visit after that, just JSON.",
    ],
  },
  {
    where: "resources/js/pages/about.vue",
    what: [
      "Receives them as props. Each page is bundled into its own chunk and fetched the first time it is needed.",
    ],
  },
  {
    where: "Layouts/PublicLayout.vue",
    what: [
      "Wraps the page. Assigned via ",
      { code: "defineOptions({ layout })" },
      ", it stays mounted across visits — the header never re-renders.",
    ],
  },
];

const TREE = [
  {
    path: "app/routes/",
    note: "One file per URL. (guest)/ and (auth)/ group them by who may visit.",
  },
  { path: "bootstrap/", note: "Application creation and the provider list." },
  { path: "config/", note: "Typed config objects, read with config('app.name')." },
  { path: "resources/js/pages/", note: "Inertia page components, one per screen." },
  { path: "resources/js/Layouts/", note: "Persistent shells that survive navigation." },
  { path: "resources/js/Components/", note: "Buttons, cards, fields — the shared vocabulary." },
  { path: "resources/css/app.css", note: "Design tokens. Every colour in the app starts here." },
  { path: "tests/", note: "Runs with the app booted via bun zt test." },
];
</script>

<template>
  <Head :title="title" />

  <div class="mx-auto max-w-3xl">
    <header>
      <p class="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">The tour</p>
      <h1 class="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
        {{ title }}
      </h1>
      <p class="mt-4 text-lg leading-relaxed text-pretty text-muted-foreground">
        One TypeScript project serves the HTML, owns the data, and renders the Vue components. Here
        is how the page you are reading got here.
      </p>
    </header>

    <section class="mt-14">
      <h2 class="font-semibold">From URL to rendered page</h2>

      <ol class="mt-6 space-y-px">
        <li v-for="(step, index) in LIFECYCLE" :key="step.where" class="flex gap-4">
          <!-- The rail: a number, and a line joining it to the next step. -->
          <div class="flex flex-col items-center">
            <span
              class="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-card font-mono text-sm text-primary"
            >
              {{ index + 1 }}
            </span>
            <span
              v-if="index < LIFECYCLE.length - 1"
              aria-hidden="true"
              class="w-px flex-1 bg-border"
            />
          </div>

          <div class="pb-8">
            <p class="font-mono text-sm text-foreground">{{ step.where }}</p>
            <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              <template v-for="(part, partIndex) in step.what" :key="partIndex">
                <Code v-if="typeof part !== 'string'">{{ part.code }}</Code>
                <template v-else>{{ part }}</template>
              </template>
            </p>
          </div>
        </li>
      </ol>
    </section>

    <section class="mt-6">
      <h2 class="font-semibold">Where things live</h2>

      <Card class="mt-5 divide-y divide-border overflow-hidden">
        <div
          v-for="entry in TREE"
          :key="entry.path"
          class="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-baseline sm:gap-6"
        >
          <span class="shrink-0 font-mono text-sm text-primary sm:w-56">{{ entry.path }}</span>
          <span class="text-sm text-muted-foreground">{{ entry.note }}</span>
        </div>
      </Card>
    </section>

    <section class="mt-14 rounded-xl border border-border bg-accent/40 p-6 sm:p-8">
      <h2 class="font-semibold">See a form do all of it</h2>
      <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
        The contact page posts to a route, validates on the server, and comes back with either a
        flash message or the errors and your original input — no client-side state to reconcile.
      </p>
      <Button :href="route('contact')" class="mt-5">
        Open the contact form
        <Icon name="arrow-right" class="size-4" />
      </Button>
    </section>
  </div>
</template>
