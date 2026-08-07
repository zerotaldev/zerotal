import { Application, basePath } from "zerotal";
import providers from "./providers";
import type { User } from "../app/models/User.ts";

// Tell @zerotal/auth which model `Auth.user()` returns. The empty body is the
// point: this augmentation exists to bind the type, not to add members.
declare module "zerotal/auth" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface UserModel extends User {}
}

const app = Application.create({ providers }).fileBasedRouting({
  web: basePath("app/flow/pages"),
});

export default app;
