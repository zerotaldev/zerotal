<script setup lang="ts">
import { Head } from "@inertiajs/vue3";
import PublicLayout from "../Layouts/PublicLayout.vue";
import Button from "../Components/Button.vue";
import Card from "../Components/Card.vue";
import Code from "../Components/Code.vue";
import Icon from "../Components/Icon.vue";
import { buttonClass } from "../lib/button";
import type { IconName } from "../lib/icons";
import { DOCS_URL } from "../lib/site";

// Inertia persistent layout — preserved across client-side navigations.
defineOptions({ layout: PublicLayout });

defineProps<{
  title: string;
  message: string;
}>();

/** Prose with inline code chips: plain strings, and `{ code }` for each chip. */
type Rich = (string | { code: string })[];

const docs = (page: string) => `${DOCS_URL}/blob/main/docs/${page}`;

const FEATURES: { icon: IconName; heading: string; body: Rich; href: string }[] = [
  {
    icon: "folder",
    heading: "File-based routing",
    body: [
      "Every file under ",
      { code: "app/routes" },
      " is a URL. Export a ",
      { code: "GET" },
      " or ",
      { code: "POST" },
      " function and the route exists — there is no registration list to keep in sync.",
    ],
    href: docs("routing.md"),
  },
  {
    icon: "layers",
    heading: "Pages, not endpoints",
    body: [
      "A route returns ",
      { code: 'Inertia.render("home", props)' },
      " and this component receives them as props. No API layer in between to build, version or keep in step.",
    ],
    href: docs("inertia.md"),
  },
  {
    icon: "shield",
    heading: "Validation that comes back",
    body: [
      { code: "validate()" },
      " returns typed data on success. On failure it flashes the errors and the submitted input and sends the user back — the form repopulates itself.",
    ],
    href: docs("validator.md"),
  },
  {
    icon: "database",
    heading: "An ORM you can read",
    body: [
      "Models, relationships, migrations, factories, and a query builder that still looks like the query you meant to write.",
    ],
    href: docs("orm/index.md"),
  },
  {
    icon: "clock",
    heading: "Background work, built in",
    body: [
      "Push a job onto a queue or put it on a schedule. Same app, same types, one ",
      { code: "bun zt worker" },
      " away.",
    ],
    href: docs("queue.md"),
  },
  {
    icon: "terminal",
    heading: "A CLI that writes the boilerplate",
    body: [
      { code: "make:page" },
      ", ",
      { code: "make:controller" },
      ", ",
      { code: "route:list" },
      ", ",
      { code: "repl" },
      " — and ",
      { code: "make:command" },
      " when you need one of your own.",
    ],
    href: docs("commands.md"),
  },
];

const NEXT_STEPS = [
  { command: "bun zt route:list", note: "Every route this app registers, in one table." },
  { command: "bun zt make:page Dashboard", note: "Scaffold a page with its layout wired up." },
  { command: "bun zt test", note: "Run the suite with the application booted." },
];
</script>

<template>
  <Head title="Home" />

  <section class="text-center">
    <span
      class="inline-flex items-center gap-2.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-muted-foreground"
    >
      <span class="relative flex size-2">
        <span
          class="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60"
        />
        <span class="relative inline-flex size-2 rounded-full bg-success" />
      </span>
      The install worked
    </span>

    <h1
      class="mx-auto mt-6 max-w-3xl bg-linear-to-br from-foreground via-foreground to-primary bg-clip-text text-4xl font-bold tracking-tight text-balance text-transparent sm:text-6xl"
    >
      {{ title }}
    </h1>

    <p class="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
      {{ message }}
    </p>

    <div class="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
      <Button :href="route('about')" size="lg">
        Take the tour
        <Icon name="arrow-right" class="size-4" />
      </Button>
      <a :href="DOCS_URL" target="_blank" rel="noreferrer" :class="buttonClass('secondary', 'lg')">
        Read the docs
      </a>
    </div>

    <p class="mt-8 text-sm text-muted-foreground">
      Edit <Code>resources/js/pages/home.vue</Code> and the page reloads itself.
    </p>
  </section>

  <section class="mt-20 sm:mt-28">
    <h2 class="text-center font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
      What you already have
    </h2>

    <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card
        v-for="feature in FEATURES"
        :key="feature.heading"
        class="group relative p-5 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/40"
      >
        <div
          class="grid size-10 place-items-center rounded-lg border border-border bg-accent text-accent-foreground transition-colors group-hover:border-primary/40"
        >
          <Icon :name="feature.icon" class="size-5" />
        </div>

        <h3 class="mt-4 font-semibold text-card-foreground">
          <!-- The pseudo-element stretches this link over the whole card, so the
               entire surface is clickable while its accessible name stays the heading. -->
          <a
            :href="feature.href"
            target="_blank"
            rel="noreferrer"
            class="after:absolute after:inset-0 after:rounded-xl"
          >
            {{ feature.heading }}
          </a>
        </h3>

        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
          <template v-for="(part, index) in feature.body" :key="index">
            <Code v-if="typeof part !== 'string'">{{ part.code }}</Code>
            <template v-else>{{ part }}</template>
          </template>
        </p>
      </Card>
    </div>
  </section>

  <section class="mt-20 sm:mt-28">
    <div class="flex items-center gap-2.5">
      <Icon name="bolt" class="size-5 text-primary" />
      <h2 class="font-semibold">Where to go next</h2>
    </div>

    <div class="mt-5 grid gap-4 sm:grid-cols-3">
      <div v-for="step in NEXT_STEPS" :key="step.command" class="space-y-2">
        <!-- A terminal-styled block for a command the reader is meant to run. -->
        <div
          class="flex items-center gap-3 rounded-lg border border-border bg-muted px-3.5 py-2.5 font-mono text-sm"
        >
          <span aria-hidden="true" class="text-primary select-none">$</span>
          <span class="overflow-x-auto text-foreground">{{ step.command }}</span>
        </div>
        <p class="px-1 text-sm text-muted-foreground">{{ step.note }}</p>
      </div>
    </div>
  </section>
</template>
