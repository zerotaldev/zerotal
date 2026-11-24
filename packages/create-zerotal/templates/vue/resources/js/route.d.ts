// `route()` in a template. app.tsx installs it on every component as a global property;
// this tells the type checker so, and keeps a misspelt route name a type error.
import type { route } from "zerotal/routes";

declare module "vue" {
  interface ComponentCustomProperties {
    route: typeof route;
  }
}

export {};
