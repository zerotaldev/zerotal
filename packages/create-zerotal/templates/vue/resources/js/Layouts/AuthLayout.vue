<script setup lang="ts">
/**
 * The shell of every screen between "signed out" and "signed in": sign in, register,
 * password reset, two-factor, email verification. A centred card, the app's name above
 * it, and nothing else competing for attention.
 *
 *   <AuthLayout title="Sign in" description="Welcome back.">
 *     …the form…
 *     <template #footer>Don't have an account? …</template>
 *   </AuthLayout>
 */
import { Link } from "@inertiajs/vue3";
import AppLogo from "../Components/AppLogo.vue";
import Card from "../Components/Card.vue";
import ThemeToggle from "../Components/ThemeToggle.vue";
import Toasts from "../Components/Toasts.vue";

defineProps<{ title: string; description?: string | undefined }>();
</script>

<template>
  <div class="relative flex min-h-dvh flex-col items-center justify-center px-4 py-12">
    <div aria-hidden="true" class="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div class="absolute inset-0 bg-grid" />
      <div class="absolute inset-x-0 top-0 h-136 bg-aurora" />
    </div>

    <div class="absolute top-4 right-4">
      <ThemeToggle />
    </div>

    <Link :href="route('home')" class="rounded-lg">
      <AppLogo class="text-lg" />
    </Link>

    <main id="main" class="mt-8 w-full max-w-md">
      <Card class="p-6 shadow-sm sm:p-8">
        <h1 class="text-xl font-semibold tracking-tight text-balance">{{ title }}</h1>
        <p v-if="description" class="mt-1.5 text-sm text-pretty text-muted-foreground">
          {{ description }}
        </p>
        <div class="mt-6"><slot /></div>
      </Card>

      <div v-if="$slots.footer" class="mt-6 text-center text-sm text-muted-foreground">
        <slot name="footer" />
      </div>
    </main>

    <Toasts />
  </div>
</template>
