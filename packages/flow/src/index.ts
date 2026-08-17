/**
 * Flow — reactive server-side rendering over WebSocket for Zerotal.
 *
 * You write a {@link Component} as a server-side class: public state lives on
 * the instance, `render()` returns server-rendered HTML, and methods marked
 * {@link expose} are callable from the browser. When a user interacts, the
 * action runs on the server, the component re-renders, and only the HTML diff
 * is streamed back and morphed into the DOM (Alpine-style) — no client-side
 * component code, no separate API. Snapshots that cross the wire are
 * HMAC-signed and only {@link expose}d / {@link locked} properties are shared.
 *
 * The toolkit here covers the whole authoring surface: the {@link Component}
 * base and {@link Layout}, the decorator set ({@link expose}, {@link locked},
 * {@link computed}, {@link task}, {@link validate}, {@link on}, {@link url},
 * {@link session}, {@link presence}, {@link shared}, …), {@link Form}s,
 * {@link paginate | pagination}, file uploads ({@link FileUploads}), realtime
 * presence and cross-client stores, and a library of ready-made view
 * components ({@link Modal}, {@link Link}, {@link Flash}, …).
 *
 * @example Register the provider
 * ```ts
 * // bootstrap/providers.ts
 * import { SessionProvider } from "@zerotal/session";
 * import { FlowProvider } from "@zerotal/flow";
 *
 * export default [SessionProvider, FlowProvider];
 * ```
 *
 * @example A reactive counter component
 * ```tsx
 * import { Component, expose } from "@zerotal/flow";
 * import type { HtmlNode } from "@zerotal/flow";
 *
 * export class Counter extends Component {
 *   count = 0;
 *
 *   @expose increment(): void {
 *     this.count++;
 *   }
 *
 *   render(): HtmlNode {
 *     return (
 *       <button flow:click="increment">
 *         Clicked {this.count} times
 *       </button>
 *     );
 *   }
 * }
 * ```
 *
 * @remarks
 * Components are authored in `.tsx` with `jsxImportSource` set to
 * `@zerotal/flow` (see `@zerotal/flow/jsx-runtime`). Register
 * `FlowProvider` after `SessionProvider`. Requires **Bun ≥ 1.1**.
 *
 * @packageDocumentation
 */

// ── @zerotal/flow public API ────────────────────────────────────────────────────

// Side-effect import: augments @zerotal/core RouterMacros so Router.flow() is typed.
import "./augment.ts";

// Core Component class + layout base + decorators
export { Component, ErrorField } from "./Component.ts";
export type {
  ErrorsProxy,
  FlowEffects,
  RedirectFlash,
  FlashBuilder,
  FlashOptions,
} from "./Component.ts";
// Mixin authoring types. Compose them onto a page with the `Component.using(...)` static —
// `class PostsPage extends Component.using(Pagination, …)`.
export type { Constructor, Mixin, Compose } from "./mixins.ts";
export { Layout } from "./Layout.ts";
export { Form, registerForm } from "./Form.ts";
// Global client store — app-wide, client-only reactive UI state, read in JSX as
// `$flow.$store.*`. `defineStore` declares its initial shape at app start; augment
// `FlowStore` to type it.
export { defineStore } from "./store.ts";
export type { FlowStore } from "./store.ts";
// Pagination state mixin (compose with `Component.using(Pagination)`); `paginate`/`Paginator`
// are the in-memory paginator.
export { paginate, Pagination } from "./pagination.ts";
export type { Paginator } from "./pagination.ts";
export {
  Link,
  Head,
  Persist,
  Title,
  Modal,
  Flash,
  Errors,
  ErrorMessage,
  Dropdown,
  Tabs,
  InfiniteScroll,
  For,
  Loading,
  Skeleton,
  Pager,
  FileUpload,
  Tooltip,
  Alert,
  Table,
  Drawer,
  ErrorBoundary,
  SectionContent,
  SectionOutlet,
  Virtualize,
} from "./components.ts";
export type {
  LinkProps,
  ModalProps,
  FlashProps,
  ErrorsProps,
  ErrorProps,
  DropdownProps,
  TabsProps,
  TabItem,
  InfiniteScrollProps,
  ForProps,
  LoadingProps,
  SkeletonProps,
  PagerProps,
  FileUploadProps,
  TooltipProps,
  AlertProps,
  TableProps,
  TableColumn,
  DrawerProps,
  ErrorBoundaryProps,
  SectionContentProps,
  SectionOutletProps,
  VirtualizeProps,
} from "./components.ts";

// Headless (unstyled, accessible) primitives — data-* state, Tailwind-friendly.
export {
  Switch,
  Disclosure,
  Accordion,
  Popover,
  Checkbox,
  Select,
  RadioGroup,
  Listbox,
  Combobox,
  Field,
  Label,
  Description,
  Fieldset,
  Legend,
  Slider,
  ToggleGroup,
  Calendar,
} from "./headless.ts";
export type {
  SwitchProps,
  DisclosureProps,
  AccordionProps,
  AccordionItem,
  PopoverProps,
  CheckboxProps,
  SelectProps,
  SelectOption,
  RadioGroupProps,
  RadioOption,
  ListboxProps,
  ListboxOption,
  ComboboxProps,
  ComboboxOption,
  FieldProps,
  LabelProps,
  DescriptionProps,
  FieldsetProps,
  LegendProps,
  SliderProps,
  ToggleGroupProps,
  ToggleOption,
  CalendarProps,
} from "./headless.ts";
export { computed } from "./decorators.ts";
export { transient } from "./decorators.ts";
export { expose } from "./decorators.ts";
export { locked } from "./decorators.ts";
export { renderless } from "./decorators.ts";
export { task } from "./decorators.ts";
export { validate } from "./decorators.ts";
export { on } from "./decorators.ts";
export type { ListenerName } from "./decorators.ts";
export { url } from "./decorators.ts";
export { param } from "./decorators.ts";
export { session } from "./decorators.ts";
export type { SessionOptions } from "./decorators.ts";
export { reactive } from "./decorators.ts";
export { modelable } from "./decorators.ts";
export { presence } from "./decorators.ts";
export type { PresenceChannel } from "./decorators.ts";
export type { PresenceMember } from "./presence.ts";
export { shared } from "./decorators.ts";
export type { SharedChannel } from "./decorators.ts";
export { getSharedStore, setSharedStore } from "./shared.ts";
export type { SharedStore } from "./shared.ts";
export { getDurableStore, setDurableStore } from "./durable.ts";
export type { DurableStore, DurableOption } from "./durable.ts";
export { registerFlowEvent } from "./events.ts";
export type { FlowEvents, EventName, EventPayload } from "./events.ts";

// Framework instrumentation events (emitted on the core FrameworkEvents bus)
export { WebSocketConnected, WebSocketDisconnected, FlowActionHandled } from "./frameworkEvents.ts";

// Provider + router helper
export { FlowProvider, flowActiveConnections, flowConnections } from "./provider/FlowProvider.ts";
export { FlowConfig, DEFAULT_PERSISTENT_MIDDLEWARE } from "./config.ts";
export type { FlowConfigShape } from "./config.ts";
export type { FlowConnection } from "./provider/FlowProvider.ts";

// Synthesizer extension point
export { registerSynth } from "./synths/index.ts";
export type { Synth } from "./synths/index.ts";

// Model registration helper
export { registerFlowModel } from "./synths/ModelSynth.ts";

// Side-effect imports: register built-in synths.
import "./synths/CarbonSynth.ts";
import "./synths/CarbonIntervalSynth.ts";
import "./synths/CollectionSynth.ts";
import "./synths/DateSynth.ts";
import "./synths/TemporaryUploadedFileSynth.ts";

// File uploads
export { TemporaryUploadedFile } from "./uploads/TemporaryUploadedFile.ts";
export type { UploadRef } from "./uploads/TemporaryUploadedFile.ts";
// File-upload management mixin (compose with `Component.using(FileUploads)`).
export { FileUploads } from "./uploads/FileUploads.ts";

// Validation
export { ValidationError } from "./validation.ts";
export type { ValidationRules } from "./validation.ts";

// Types
export type {
  Snapshot,
  SnapshotData,
  SnapshotMemo,
  ChildMemo,
  CallFrame,
  PatchFrame,
  FlashFrame,
  RedirectFrame,
  ErrorFrame,
  EventFrame,
  DownloadFrame,
  FlashLevel,
  FlashMessage,
  FlashPosition,
  FlashAction,
  FlashActionStyle,
  FlashActionVariant,
  FlashCallback,
} from "./types.ts";

export type { HtmlNode } from "./jsx-runtime.ts";
export type { PageClassWithMeta } from "./registry.ts";
export { registerComponent } from "./registry.ts";
export type { UrlOptions } from "./decorators.ts";

// Core utilities
export { flow, jsLiteral } from "./utils.ts";
export { isSafeUrl, sanitizeUrl, URL_ATTRIBUTES, BLOCKED_URL } from "./urlSafety.ts";
export type { FlowChain } from "./utils.ts";
