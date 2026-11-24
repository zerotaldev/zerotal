// Ambient declarations for non-code assets imported from TypeScript and bundled
// by `bun zt serve` (see the `assets` block in config/app.ts). These let
// side-effect imports like `import "../css/app.css"` type-check.
declare module "*.css";
declare module "*.scss";
declare module "*.svg";
declare module "*.png";
declare module "*.jpg";
declare module "*.jpeg";
declare module "*.gif";
declare module "*.webp";
declare module "*.woff";
declare module "*.woff2";

// Type the global client store by declaring your namespaces here. Every `$flow.store.*`
// access in your components is then fully typed. Keep in sync with the `defineStore(…)`
// call in resources/js/app.ts.
//
// declare module "@zerotal/flow/store" {
//   interface FlowStore {
//     ui: { dark: boolean; sidebar: boolean };
//   }
// }
