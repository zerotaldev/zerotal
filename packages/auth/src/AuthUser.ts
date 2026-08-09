import { BaseModel } from "@zerotal/orm";
import { Authenticatable } from "./Authenticatable.ts";

/**
 * Base class for authenticatable user models — `Authenticatable(BaseModel)`.
 *
 * Extend this instead of `BaseModel` to get the auth contract (`getAuthId()` +
 * `getAuthPassword()`) out of the box. It carries **no** role or permission logic;
 * compose those with `Model.using`:
 *
 * @example
 * // app/models/User.ts — simple case
 * import { column, table } from "@zerotal/orm";
 * import { AuthUser } from "@zerotal/auth";
 *
 * @table("users")
 * export class User extends AuthUser {
 *   @column() name!: string;
 *   @column() email!: string;
 *   @column() password?: string | null;
 * }
 *
 * @example
 * // with roles + permissions — flat, no wrapper nesting
 * import { Model } from "@zerotal/orm";
 * import { Authenticatable, Roles, Permissions } from "@zerotal/auth";
 *
 * export class User extends Model.using(Authenticatable, Permissions, Roles) {}
 */
export class AuthUser extends Authenticatable(BaseModel) {}
