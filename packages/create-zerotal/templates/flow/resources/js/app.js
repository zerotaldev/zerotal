/**
 * The browser script: resources/js/app.js, bundled to public/js/app.js — by `bun zt dev`
 * on every change, and by `bun zt assets:build` for a release. A `.js` file because that
 * is the entry Flow's dev build looks for; the modules it imports are TypeScript.
 *
 * The pages are written on the server (app/flow/pages/), so most of what they do needs
 * nothing from here. This adds what HTML can't do alone — menus, dialogs, the theme,
 * toasts that go away, PUT and DELETE forms, and passkeys — by looking for data attributes
 * the components write. Each listener sits on the document, so markup that arrives later
 * (a Flow update, a toast) is covered without being wired up.
 *
 * Flow's own runtime is loaded separately, by the framework, on every page.
 */
import { installActions } from "./lib/actions.ts";
import { installDisclosures } from "./lib/disclosures.ts";
import { installDropdowns } from "./lib/dropdowns.ts";
import { installForms } from "./lib/forms.ts";
import { installModals } from "./lib/modals.ts";
import { installPasskeys } from "./lib/passkey-ui.ts";
import { installTheme } from "./lib/theme.ts";
import { installToasts } from "./lib/toasts.ts";

installTheme();
installToasts();
installDropdowns();
installModals();
installDisclosures();
installForms();
installPasskeys();
installActions();
