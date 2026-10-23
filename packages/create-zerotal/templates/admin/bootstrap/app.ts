import { Application, basePath } from "zerotal";
import providers from "./providers";
import type { User } from "../app/models/User.ts";

// Tell @zerotal/auth which model `Auth.user()` returns. The empty body is the
// point: this augmentation exists to bind the type, not to add members.
declare module "zerotal/auth" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface UserModel extends User {}
}

// This app is the admin panel. AdminProvider loads `app/admin/index.ts` on boot and
// mounts every route from what it registers; the one route declared here is the bare
// origin, which sends a visitor to the panel instead of a 404.
const app = Application.create({ providers }).routing({
  web: basePath("routes/web.ts"),
});

export default app;
