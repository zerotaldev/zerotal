// ── Factory function ──────────────────────────────────────────────────────────
//
// Its own module rather than a member of `index.ts`, so the browser entry can
// re-export it without pulling the server half of the barrel back in. That is
// not hypothetical tidiness: `browser.ts` originally took it from `index.ts`,
// which re-imported `ClientProvider` and put the bundle straight back into the
// error this split exists to remove.

import { ApiClient } from "./ApiClient.ts";
import type { ApiRouteMap } from "./types.ts";
import type { ApiClientConfig } from "./ApiClient.ts";

/**
 * Create a type-safe API client bound to your route map.
 *
 * @example
 * // frontend/api.ts
 * import { createApiClient } from '@zerotal/client';
 * import type { Routes } from './routes';
 *
 * export const api = createApiClient<Routes>({
 *   baseUrl: '/api',
 *   headers: { 'X-Requested-With': 'XMLHttpRequest' },
 * });
 *
 * // Anywhere in your UI:
 * const user = await api.get('/users/{id}', { id: 1 });
 * //    ^? UserResource  (inferred from Routes)
 *
 * const newUser = await api.post('/users', { name: 'Alice', email: 'alice@ex.com' });
 */
export function createApiClient<Routes extends ApiRouteMap>(
  config: ApiClientConfig = {},
): ApiClient<Routes> {
  return new ApiClient<Routes>(config);
}
