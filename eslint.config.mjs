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
    },
  },

  // ── Tests, scripts, and example apps: relax `any` entirely ──────────────────
  {
    files: ["**/*.test.ts", "scripts/**", "apps/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
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
