import { column, table } from "zerotal/orm";
import { AuthUser } from "zerotal/auth";

/** Someone who can sign in and publish. Posts belong to a user. */
@table("users")
export class User extends AuthUser {
  static override hidden = ["password"];
  static override fillable = ["name", "email", "password"];

  @column() name!: string;
  @column() email!: string;
  /** Always stored hashed — see `Hash.make()` in the seeder. */
  @column() password!: string;
}

// Tell @zerotal/auth which model `Auth.user()` returns. The empty body is the
// point: this augmentation exists to bind the type, not to add members.
declare module "@zerotal/auth" {
  interface UserModel extends User {}
}
