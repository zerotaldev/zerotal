import { Model, column, table } from "zerotal/orm";
import { Authenticatable } from "zerotal/auth";

/**
 * `Model.using(Authenticatable)`, not a plain `Model`.
 *
 * The mixin is what brands the class so `authUserModel()` can find it. Without
 * the brand nothing errors and nothing warns — the model saves, queries and
 * hashes exactly as before — but `Auth.attempt()` resolves *no* user model at
 * all and therefore returns `false` for every correct password. Registration
 * appears to work while login silently never succeeds.
 *
 * It also supplies `getAuthId()` / `getAuthPassword()`, which the auth flow
 * reads, and registers the `rememberToken` column that "remember me" needs.
 */
@table("users")
export class User extends Model.using(Authenticatable) {
  // Models guard every attribute by default. Only these may be mass-assigned
  // from a request body — `role` is deliberately absent, so no amount of extra
  // fields in a form post can promote the account that submitted it.
  static override fillable = ["name", "email", "password"];

  // Never serialised into a rendered page or a JSON response.
  static override hidden = ["password"];

  @column({ type: "string" }) name!: string;
  @column({ type: "string" }) email!: string;
  @column({ type: "string" }) password!: string;
  @column({ type: "string", nullable: true, default: "user" }) role?: string | undefined;
}
