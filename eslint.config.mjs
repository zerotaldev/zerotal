// Flat ESLint config wired to CODING_STYLE.md.
//
// Mechanical language rules (§11) are errors; `no-explicit-any` (§10) is a WARNING
// so each remaining `any` can be removed or annotated over time without failing the
// build. The leading-underscore namespacing convention (§13) is intentionally NOT
// flagged (eslint's no-underscore-dangle stays off). Formatting is Prettier's job —
// eslint-config-prettier (last) disables any stylistic rules that would conflict.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  // ── Ignore generated, vendored, and template-emitting code ──────────────────
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.tsbuild/**",
      "**/build/**",
      "**/coverage/**",
      "**/*.d.ts",
      ".claude/**",
      // create-zerotal emits source files as template strings — not our source.
      "packages/create-zerotal/**",
      // Generated / fixture code.
      "**/__test_migrations__/**",
      "**/__fixtures__/**",
      // Flow compiles components into .zerotal/compiled/*.ts at build time —
      // regenerated artifacts, never hand-edited.
      "**/.zerotal/**",
      // Generated registries (e.g. pages.generated.ts from the page scanner).
      "**/*.generated.*",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  // ── House rules (CODING_STYLE.md) ───────────────────────────────────────────
  {
    rules: {
      // §11 Language hygiene — errors.
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }], // `== null` is allowed

      // §10 Types — warn-with-reason. Any remaining `any` must carry an inline
      // `// eslint-disable-next-line @typescript-eslint/no-explicit-any — <reason>`.
      "@typescript-eslint/no-explicit-any": "warn",

      // Unused vars: warn, but allow intentional `_`-prefixed throwaways
      // (e.g. destructured `{ children: _ignore, ...rest }`).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // §13 underscore namespacing on extensible base classes + @internal exports
      // is a deliberate convention — keep no-underscore-dangle off.
      "no-underscore-dangle": "off",

      // Empty interfaces are this codebase's augmentation seams (FlowEvents,
      // ContextRegistry, AuthenticatableUser, …) — apps merge members into them.
      "@typescript-eslint/no-empty-object-type": ["error", { allowInterfaces: "always" }],

      // `APP_ENV` means two things and the second destroys the first: it is the
      // deployment name an operator sets, and it is the runtime mode `setAppEnv()`
      // overwrites it with before the app boots. Reading it to answer "is this
      // production?" therefore asks whether "web" is production, and gets no.
      //
      // That mistake shipped fourteen times across seven packages before anyone
      // went looking: a weak APP_KEY never refused a boot, N+1 detection ran in
      // production, the Flow client bundle was never minified, auto-synchronize
      // was not hard-off, `forceState()` worked on live data, env-scoped schedules
      // never ran, and every dev surface — DevTools included — switched itself off.
      // Each was found separately. This rule is so the fifteenth is found here.
      //
      // Use `deployEnv()` for the deployment name, or `config("app.env")` where the
      // config store is available. Reading `APP_ENV` for the *runtime mode* is
      // legitimate — disable this rule on the line and say which you mean.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.object.name='Bun'][object.property.name='env'][property.value='APP_ENV']",
          message:
            'Bun.env["APP_ENV"] holds the runtime mode after setAppEnv(). Use deployEnv() for the deployment name, or config("app.env"). If you genuinely want the runtime mode, disable this rule on the line with a reason.',
        },
        {
          selector:
            "MemberExpression[object.object.name='Bun'][object.property.name='env'][property.name='APP_ENV']",
          message:
            'Bun.env.APP_ENV holds the runtime mode after setAppEnv(). Use deployEnv() for the deployment name, or config("app.env"). If you genuinely want the runtime mode, disable this rule on the line with a reason.',
        },
      ],
    },
  },

  // ── Tests, scripts, and example apps: relax `any` entirely ──────────────────
  {
    files: ["**/*.test.ts", "scripts/**", "apps/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // A test setting `APP_ENV` is constructing a scenario, not asking a question —
      // pinning the variable is precisely how you reproduce "what the server sees".
      "no-restricted-syntax": "off",
    },
  },

  // ── Scaffolded apps lint under someone else's config ────────────────────────
  //
  // `apps/**` is what `create-zerotal` emits, and it is written to be clean under
  // typescript-eslint's *recommended* set — which is what a new project gets.
  // This repo's config is deliberately more permissive in places (it allows
  // `interface X extends Y {}` via `no-empty-object-type`'s `allowInterfaces`),
  // so a suppression the template needs out there reads as dead in here.
  // Reporting it would push us to delete a comment that is load-bearing for every
  // user who is not us.
  {
    files: ["apps/**/*.{ts,tsx}"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },

  // ── Client-side bundles run in the browser (window/document/CustomEvent…) ────
  {
    files: ["packages/*/src/client/**", "packages/flow/src/**"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        CustomEvent: "readonly",
        MutationObserver: "readonly",
        WebSocket: "readonly",
        IntersectionObserver: "readonly",
      },
    },
  },
);
