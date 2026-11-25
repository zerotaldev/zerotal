// Ambient declarations for non-code assets imported from the browser script, which
// `bun zt dev` and `bun zt assets:build` bundle. These let an import like
// `import logo from "./logo.svg"` type-check.
declare module "*.css";
declare module "*.svg";
declare module "*.png";
declare module "*.jpg";
declare module "*.jpeg";
declare module "*.gif";
declare module "*.webp";
declare module "*.woff";
declare module "*.woff2";
