/**
 * The typed page registry: what turns `Inertia.render("Users/Index", props)`
 * from two strings and a bag of `unknown` into a checked call.
 *
 * The generated `resources/js/pages.generated.ts` already knows everything
 * needed — it holds one `() => import("./pages/Users/Index.tsx")` thunk per
 * page, and an `import()` thunk carries the module's full type. It used to be
 * annotated `Record<string, () => Promise<{ default: unknown }>>`, which
 * enforced the shape and discarded the rest. Written with `satisfies` instead,
 * the same file names every page and every page's props.
 *
 * It reaches the server through one declaration-merged interface:
 *
 * ```ts
 * declare module "@zerotal/inertia" {
 *   interface InertiaPageRegistry { pages: typeof pages }
 * }
 * ```
 *
 * That indirection is the point. `pages.generated.ts` lives in `resources/js`
 * and imports `.tsx` files; a controller that imported it directly would drag
 * the whole component graph into the server's type-check, and a broken
 * component would fail the server's build. The augmentation is type-only, so
 * the coupling exists in exactly one file and nothing is emitted.
 *
 * **The direction is the good part.** The page component declares its props —
 * which a React component does anyway — and the controller is checked against
 * them. Neither side writes an annotation it wasn't already writing.
 */
import type {
  AlwaysProp,
  DeferProp,
  InfiniteScrollProp,
  MergeProp,
  OptionalProp,
  PaginatorLike,
} from "./props/PropTypes.ts";

/**
 * Augmentation target for the generated page map. Filled in by
 * `resources/js/pages.generated.ts` with `{ pages: typeof pages }`.
 *
 * Empty until then, which is why every Inertia helper keeps a `string`
 * fallback: an app that has not rebuilt its registry still compiles.
 *
 * @category Extension registries
 */
export interface InertiaPageRegistry {}

/**
 * Props merged into every page by the framework, so a controller never passes
 * them. Augment it to match your app's `Inertia.share()` calls and the props
 * they contribute become optional in `Inertia.render` rather than missing:
 *
 * ```ts
 * declare module "@zerotal/inertia" {
 *   interface SharedProps {
 *     auth: { user: { id: number; name: string } | null };
 *     appName: string;
 *   }
 * }
 * ```
 *
 * Hand-written on purpose. `share(key, value)` is a runtime call in a provider,
 * so no generator can see it; the list is small, stable, and app-specific.
 *
 * @category Extension registries
 */
export interface SharedProps {}

/**
 * The shared props the framework merges on every request whatever the app does
 * — see `sharedProps()`. Kept separate from {@link SharedProps} rather than
 * declared in it: an app that types `auth.user` as its own `User` would
 * otherwise be redeclaring a member of the same interface, which is a merge
 * conflict rather than a refinement.
 */
interface BuiltInSharedProps {
  auth: { user: unknown };
  flash: { success: string | null; error: string | null };
  errors: Record<string, string>;
  old: Record<string, unknown>;
}

/** Everything a controller may leave out because something else supplies it. */
type AllSharedProps = SharedProps & BuiltInSharedProps;

/** The generated `pages` map, or an empty map before the registry exists. */
type PageModules = InertiaPageRegistry extends { pages: infer Map } ? Map : Record<never, never>;

/** Every page name in the generated registry. `never` until it is generated. */
export type PageName = Extract<keyof PageModules, string>;

/**
 * What the Inertia helpers accept as a component name: the generated page names
 * once the registry exists, any string before that.
 */
export type PageTarget = [PageName] extends [never] ? string : PageName;

/** The default export of page `N`'s module. */
type PageComponent<N extends string> = N extends keyof PageModules
  ? PageModules[N] extends () => Promise<{ default: infer Component }>
    ? Component
    : unknown
  : unknown;

/**
 * The props a component declares, read off its own signature.
 *
 * Structural on purpose — `@zerotal/inertia` must not import React types (React
 * is an optional peer; a Vue app never installs it). A function component's
 * first parameter and a class component's constructor prop both match here.
 *
 * Anything else — a `React.memo()` wrapper, or a `.vue` SFC resolved through a
 * `declare module '*.vue'` shim that types the default export as
 * `DefineComponent<{}, {}, any>` — has no readable props, and falls back to an
 * open record so those pages keep compiling rather than failing on a shape
 * nobody can see. See the Vue note in the props docs.
 */
type PropsOfComponent<Component> = Component extends (
  props: infer Props,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matching any component signature, whose extra args (React's legacy context) are irrelevant here.
  ...rest: any[]
) => // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a component returns JSX, ReactNode, a Promise of either…
any
  ? Props
  : Component extends abstract new (
        props: infer Props,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...rest: any[]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) => any
    ? Props
    : Record<string, unknown>;

/** The props page `N`'s component declares. */
export type PropsOf<N extends string> = PropsOfComponent<PageComponent<N>>;

/**
 * What a controller may pass for a prop the component declares as `T`.
 *
 * The two sides genuinely differ: the controller passes `optional(() => posts)`
 * and the component receives `Post[]`. So each prop accepts its value, a
 * factory for it, or a wrapper carrying it.
 *
 * **`optional` and `defer` are only allowed where `T` admits `undefined`.**
 * They are absent on first paint by definition, so a component that declares
 * the prop as required is wrong about its own contract — and a type that
 * accepted them anyway would launder that bug into something the compiler
 * signed off on. `always`, `merge` and `scroll` are present on first paint, so
 * they are allowed everywhere.
 */
export type PropInput<T> =
  | T
  | (() => T | Promise<T>)
  | AlwaysProp<T>
  | MergeProp<T>
  // `scroll()` resolves to the paginator it was given, so it only fits a prop
  // the component declares as paginator-shaped.
  | (T extends PaginatorLike ? InfiniteScrollProp : never)
  | (undefined extends T ? OptionalProp<T> | DeferProp<T> : never);

/** Apply {@link PropInput} to every prop, preserving optional and readonly modifiers. */
type PropInputs<T> = { [K in keyof T]: PropInput<T[K]> };

/**
 * The props `Inertia.render(N, …)` requires: everything page `N` declares, each
 * accepting its wrappers — minus the shared props, which the framework merges
 * in. Shared props stay *accepted* (a controller may override `auth` for one
 * page) but are never required, and a page component that declares one doesn't
 * make every controller pass it.
 */
export type RenderProps<N extends string> = [PageName] extends [never]
  ? Record<string, unknown>
  : Omit<PropInputs<PropsOf<N>>, keyof AllSharedProps> & Partial<PropInputs<AllSharedProps>>;

/**
 * `render()`'s arguments after the component name: the props bag is optional
 * only when the page requires nothing of it.
 */
export type RenderArgs<N extends string> = [PageName] extends [never]
  ? [props?: Record<string, unknown>]
  : // "every prop is optional" — an empty object satisfies the page.
    Record<never, never> extends RenderProps<N>
    ? [props?: RenderProps<N>]
    : [props: RenderProps<N>];
