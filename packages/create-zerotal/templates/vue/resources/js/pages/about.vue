<script setup lang="ts">
import { Head, useForm } from "@inertiajs/vue3";
import PublicLayout from "../Layouts/PublicLayout.vue";
import Button from "../Components/Button.vue";
import Card from "../Components/Card.vue";
import Code from "../Components/Code.vue";
import Icon from "../Components/Icon.vue";
import TextAreaField from "../Components/TextAreaField.vue";
import TextField from "../Components/TextField.vue";

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

// The contact form at the foot of the page. The browser posts, the server validates, and
// a failure comes back as a redirect carrying `errors`; `useForm` keeps what was typed.
// The matching route is app/routes/about.ts.
const form = useForm({ name: "", email: "", message: "" });

function submit() {
  // The form is at the foot of a long page: stay there while the server answers. A
  // success clears the fields; a failure leaves them, with the errors beside them.
  form.post(route("about.store"), { preserveScroll: true, onSuccess: () => form.reset() });
}
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

    <section id="contact" class="mt-14 scroll-mt-24">
      <p class="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">Say hello</p>
      <h2 class="mt-3 text-2xl font-bold tracking-tight">Get in touch</h2>
      <p class="mt-3 leading-relaxed text-pretty text-muted-foreground">
        This form is the pattern every other one follows. Submit it empty, or with a malformed
        address, and watch the server send the errors and your input straight back.
      </p>

      <div class="mt-6 grid gap-6 lg:grid-cols-5">
        <Card class="p-6 sm:p-8 lg:col-span-3">
          <form class="space-y-5" novalidate @submit.prevent="submit">
            <TextField
              v-model="form.name"
              label="Name"
              name="name"
              :error="form.errors.name"
              autocomplete="name"
              placeholder="Ada Lovelace"
            />

            <TextField
              v-model="form.email"
              label="Email"
              name="email"
              type="email"
              :error="form.errors.email"
              autocomplete="email"
              placeholder="ada@example.com"
            />

            <TextAreaField
              v-model="form.message"
              label="Message"
              name="message"
              :error="form.errors.message"
              hint="At least 10 characters."
              placeholder="What's on your mind?"
            />

            <div class="flex items-center gap-3 pt-1">
              <Button type="submit" :disabled="form.processing">
                <span
                  v-if="form.processing"
                  aria-hidden="true"
                  class="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
                {{ form.processing ? "Sending…" : "Send message" }}
              </Button>
              <p class="text-sm text-muted-foreground">Nothing is stored — see the route.</p>
            </div>
          </form>
        </Card>

        <div class="space-y-6 lg:col-span-2">
          <Card class="p-6">
            <h2 class="font-semibold text-card-foreground">What happens on submit</h2>
            <ol class="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
              <li>
                <span class="font-medium text-foreground">1.</span> The POST reaches
                <Code>app/routes/about.ts</Code>.
              </li>
              <li>
                <span class="font-medium text-foreground">2.</span> <Code>validate()</Code> checks
                the body and returns typed data.
              </li>
              <li>
                <span class="font-medium text-foreground">3.</span> If it fails, errors and input
                are flashed and you are redirected back.
              </li>
              <li>
                <span class="font-medium text-foreground">4.</span> If it passes, a success flash
                becomes the toast in the corner.
              </li>
            </ol>
          </Card>

          <Card class="p-6">
            <h2 class="font-semibold text-card-foreground">Prefer email?</h2>
            <a
              href="mailto:hello@example.com"
              class="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary transition-opacity hover:opacity-80"
            >
              <Icon name="mail" class="size-4" />
              hello@example.com
            </a>
          </Card>
        </div>
      </div>
    </section>
  </div>
</template>
