import { computed, type ComputedRef } from "vue";
import { usePage } from "@inertiajs/vue3";
import type { SharedProps } from "../types";

/**
 * The app's name, as config/app.ts sets it. It reaches the browser as the shared
 * `app` prop, so renaming the app is one change on the server and nothing here.
 */
export function useAppName(): ComputedRef<string> {
  const page = usePage<SharedProps>();
  return computed(() => page.props.app?.name ?? "");
}

/** Where the "Docs" links point. */
export const DOCS_URL = "https://zerotal.dev/docs";
