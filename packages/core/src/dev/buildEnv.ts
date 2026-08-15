/**
 * The `import.meta.env` members a bundled browser build is expected to carry.
 *
 * These are a Vite convention, not a web standard — `import.meta.env` is
 * undefined in a browser module — but enough of the npm ecosystem branches on
 * them that a bundler which leaves them alone ships code that reads a property
 * off `undefined`. Bun's bundler leaves them alone, so we define them.
 *
 * The case that found this: the Inertia DevTools browser extension relies on
 * client-side hooks that `createInertiaApp()` enables from its `dev` option,
 * and that option's default is literally `import.meta.env.DEV`. Under Bun that
 * expression survived into the bundle, so the panel reported the app was "not
 * running in dev mode" and told the developer to start a Vite server they do
 * not have — advice that cannot be followed in a Zerotal app.
 *
 * Only the three members whose meaning is unambiguous are defined. `BASE_URL`
 * and `SSR` are deliberately omitted: Zerotal has its own answers for both
 * (`app.assets.prefix`, and SSR being a server concern), and a wrong value is
 * worse than an absent one for a package that feature-detects.
 *
 * @param isProduction Whether this build is for a deployment.
 * @internal
 */
export function browserEnvDefines(isProduction: boolean): Record<string, string> {
  return {
    // The WHOLE object, not `import.meta.env.DEV` member by member. Adapters write
    // `import.meta.env?.DEV` — optional-chained, which is why an unbundled
    // `import.meta.env` yields `false` instead of throwing — and a define keyed on
    // `import.meta.env.DEV` does not match `import.meta.env?.DEV`, so the member
    // form silently changes nothing. Replacing the object satisfies both spellings.
    //
    // Members this does not name resolve to `undefined` rather than throwing, which
    // is the right answer for a bundler that is not Vite: code that feature-detects
    // `import.meta.env.SSR` or a `VITE_*` variable gets a clean miss.
    "import.meta.env": JSON.stringify({
      DEV: !isProduction,
      PROD: isProduction,
      MODE: isProduction ? "production" : "development",
    }),
  };
}
