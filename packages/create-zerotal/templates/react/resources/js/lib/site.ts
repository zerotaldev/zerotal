import { usePage } from "@inertiajs/react";
import type { SharedProps } from "../types";

/**
 * The app's name, as config/app.ts sets it. It reaches the browser as the shared
 * `app` prop, so renaming the app is one change on the server and nothing here.
 */
export function useAppName(): string {
  return usePage<SharedProps>().props.app?.name ?? "";
}

/** Where the header and footer "Docs" links point. */
export const DOCS_URL = "https://github.com/zerotaldev/zerotal";
