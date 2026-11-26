// Check each Vue page's props where a route renders it, as a React page's are: a missing
// prop, an extra one or one of the wrong type in `Inertia.render("page", { … })` is a
// type error in the route, caught by `bun run typecheck` (vue-tsc).
// See https://zerotal.dev/docs/inertia/props
declare module "@zerotal/inertia" {
  interface InertiaTypeOptions {
    checkVueProps: true;
  }
}

export {};
