// Ambient declarations for non-code assets imported from TypeScript and bundled
// by `bun zt serve` (see the `assets` block in config/app.ts). These let
// side-effect imports like `import "../css/app.css"` type-check.
// `.vue` files need no declaration here: `bun run typecheck` runs vue-tsc, which reads
// each component's real props.

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
