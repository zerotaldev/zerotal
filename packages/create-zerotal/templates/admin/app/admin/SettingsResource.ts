import { Resource, text, textInput, toggle, formSection } from "@zerotal/admin";
import { Setting } from "@app/models/Setting";

/**
 * Site settings — one row, edited directly.
 *
 * `singular` collapses the usual list → view → edit chain into a single route:
 * `/admin/settings` opens the form. There is nothing to list when there is only
 * ever one record, and no id worth putting in a URL.
 */
export class SettingsResource extends Resource {
  static override model = Setting;
  static override singular = true;
  static override slug = "settings";
  static override label = "Settings";
  static override pluralLabel = "Settings";
  static override navigationIcon = "shield";
  static override navigationGroup = "System";
  static override navigationSort = 99;

  static override columns() {
    return [text("siteName").label("Site name")];
  }

  static override form() {
    return [
      formSection("Identity")
        .description("How the site presents itself")
        .columns(2)
        .schema([
          textInput("siteName").label("Site name").required().default("My Shop").maxLength(80),
          textInput("supportEmail").label("Support email").email().default("support@example.com"),
          toggle("ordersOpen").label("Accepting orders").default(true).columnSpan(2),
        ]),
    ];
  }
}
