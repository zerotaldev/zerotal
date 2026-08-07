import {
  Resource,
  text,
  imageColumn,
  textInput,
  select,
  formSection,
  section,
  textEntry,
  imageEntry,
  createAction,
  exportAction,
} from "@zerotal/admin";
import { Hash } from "zerotal/auth";
import { User } from "@app/models/User";
import { humanDate } from "@app/admin/shared";

const ROLES = {
  admin: "Administrator",
  editor: "Editor",
  support: "Support",
  viewer: "Viewer",
};

/** Panel users. Sits outside every cluster — access is nobody's business area. */
export class UserResource extends Resource {
  static override model = User;
  static override navigationIcon = "shield";
  static override navigationGroup = "System";
  static override navigationSort = 90;
  static override recordTitleAttribute = "name";
  static override defaultSort = { column: "created_at", direction: "desc" as const };

  static override headerActions() {
    return [createAction(), exportAction()];
  }

  static override columns() {
    return [
      imageColumn("avatarUrl").label("").circular().exportable(false),
      text("name").searchable().sortable(),
      text("email").searchable().copyable(),
      text("roles")
        .label("Roles")
        .format((v) => (Array.isArray(v) && v.length > 0 ? v.join(", ") : "—")),
      text("createdAt")
        .label("Joined")
        .sortable()
        .format((v) => humanDate(v)),
    ];
  }

  static override form() {
    return [
      formSection("Identity")
        .columns(2)
        .schema([
          textInput("name").required().minLength(2).maxLength(120).autocomplete("name"),
          textInput("email").email().required().maxLength(160).autocomplete("email"),
          textInput("avatarUrl").label("Avatar URL").url().columnSpan(2),
          select("roles").label("Roles").multiple().searchable().options(ROLES).columnSpan(2),
        ]),
      formSection("Security").schema([
        // Only asked for on create, and hashed on the way to the database — the
        // panel never holds a plaintext password.
        textInput("password")
          .password()
          .required()
          .minLength(8)
          .helperText("At least 8 characters.")
          .visibleOn("create")
          .columnSpan(2)
          .mutate((value) => Hash.make(String(value))),
      ]),
    ];
  }

  static override infolist() {
    return [
      section("Profile")
        .icon("shield")
        .columns(2)
        .schema([
          imageEntry("avatarUrl").label("Avatar").circular().height(64),
          textEntry("name").weight("semibold").size("lg"),
          textEntry("email").icon("mail").copyable(),
          textEntry("roles")
            .label("Roles")
            .format((v) => (Array.isArray(v) && v.length > 0 ? v.join(", ") : "—")),
          textEntry("createdAt").label("Joined").icon("calendar").since(),
        ]),
    ];
  }

  static override emptyState() {
    return {
      heading: "No users yet",
      description: "Invite the people who will run this panel.",
      icon: "shield",
      actions: [createAction()],
    };
  }
}
