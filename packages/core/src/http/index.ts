/**
 * The `@zerotal/core/http` module — everything for talking HTTP from the
 * server side and shaping HTTP responses. It groups five concerns:
 *
 *  - **Outbound requests** — the {@link Http} facade and its fluent
 *    {@link PendingRequest} builder for server-to-server calls, with headers,
 *    auth, timeouts, retries, and a `fake()` test harness.
 *  - **URL building & signing** — the immutable {@link Uri} value object
 *    ({@link uri}) and the app-aware {@link Url} service ({@link url}) for
 *    fully-qualified, named-route, and HMAC-signed links.
 *  - **Uploads** — {@link UploadedFile} for validating and storing multipart
 *    form files.
 *  - **API resources** — {@link Resource} and {@link ResourceCollection} for
 *    transforming models into JSON response envelopes.
 *  - **Content negotiation** — {@link negotiate} / {@link detectChannel} for
 *    branching a handler by web / JSON / CLI client.
 *
 * @example
 * import { Http, uri } from '@zerotal/core/http';
 *
 * const target = uri('https://api.example.com/users').withQuery({ page: 2 }).value();
 * const users  = await Http.withToken(token).timeout(5000).get(target).json();
 *
 * @packageDocumentation
 */
export { Uri, uri } from "./Uri.ts";
export type { UriQueryString, QueryInput } from "./Uri.ts";
export { url, Url, UrlKeyMissingError } from "./url.ts";
export type { UrlGenerator } from "./url.ts";
export { Http } from "./Http.ts";
export { UploadedFile } from "./UploadedFile.ts";
export type { StorageDisk, FileValidationOptions } from "./UploadedFile.ts";
export { HttpClientResponse, HttpClientError, PendingRequest } from "./HttpClient.ts";
export type { FakeStub } from "./HttpClient.ts";
export { Resource, ResourceCollection } from "./Resource.ts";
export type { PaginatedData } from "./Resource.ts";
export { negotiate } from "./negotiate.ts";
export type {
  Channel,
  AnsiColor,
  WebContext,
  ApiContext,
  CliContext,
  NegotiateMap,
} from "./negotiate.ts";
export { isAllowedOrigin } from "./originGuard.ts";
