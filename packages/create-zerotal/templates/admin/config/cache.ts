import { CacheConfig } from "zerotal/cache";

// The panel caches its navigation-badge counts here, invalidating them on every
// write. In-memory suits a demo; swap the driver for redis in production.
export default CacheConfig({
  driver: "memory",
});
