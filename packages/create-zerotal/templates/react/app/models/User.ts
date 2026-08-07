import { BaseModel, column, table } from "zerotal/orm";

@table("users")
export class User extends BaseModel {
  // Models guard every attribute by default. Only these may be mass-assigned
  // from a request body — `role` is deliberately absent, so no amount of extra
  // fields in a form post can promote the account that submitted it.
  static override fillable = ["name", "email", "password"];

  // Never serialised into a rendered page or a JSON response.
  static override hidden = ["password"];

  @column({ type: "string" }) name!: string;
  @column({ type: "string" }) email!: string;
  @column({ type: "string" }) password!: string;
  @column({ type: "string", nullable: true, default: "user" }) role?: string;
}
