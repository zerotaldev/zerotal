import { env } from "zerotal";
import { InertiaConfig } from "@zerotal/inertia";

export default InertiaConfig({
  htmlTemplate: "./resources/app.html",
  version: env("ASSET_VERSION", "1"),
});
