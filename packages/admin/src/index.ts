/**
 * @zerotal/admin — a declarative, server-driven admin panel built on
 * @zerotal/flow (reactivity) and @zerotal/flow-ui (components).
 *
 * Quick start:
 *
 *   // bootstrap/providers.ts
 *   import { FlowProvider } from "@zerotal/flow";
 *   import { AdminProvider } from "@zerotal/admin";
 *   export default [FlowProvider, AdminProvider];
 *
 *   // app/admin.ts
 *   import { Panel, Resource, text } from "@zerotal/admin";
 *   import { User } from "./models/User.ts";
 *
 *   Panel.configure({ brand: "Acme", path: "/admin" });
 *
 *   class UserResource extends Resource {
 *     static model = User;
 *     static navigationIcon = "users";
 *     static navigationGroup = "Access";
 *     static columns() {
 *       return [
 *         text("id").sortable(),
 *         text("name").searchable().sortable(),
 *         text("email").searchable(),
 *         text("role").badge((v) => (v === "admin" ? "primary" : "muted")),
 *       ];
 *     }
 *   }
 *
 *   Panel.register(UserResource);
 *
 * The default UI ships with light + dark mode out of the box (Tailwind via CDN
 * for now; swap to a real build later by editing `theme.ts` only).
 */

export { Resource } from "./Resource.ts";
export type {
  AdminModel,
  AdminQuery,
  AdminRecord,
  ListOptions,
  RecordPage,
  EmptyState,
  QueryModifier,
} from "./Resource.ts";

export { Panel, PanelInstance, DEFAULT_PANEL_ID } from "./Panel.ts";
export type { ResourceClass, NavItem, NavGroup, PanelPage } from "./Panel.ts";

// Render hooks — named positions in the chrome anything can render into.
export { resolveRenderHooks } from "./renderHooks.ts";
export type { RenderHook, RenderHookName, RenderHookContext } from "./renderHooks.ts";

// Database-backed notifications for the bell.
export { databaseNotifications } from "./databaseNotifications.ts";
export type { DatabaseNotificationOptions, StoredNotification } from "./databaseNotifications.ts";

// Clusters — a shared URL segment and sidebar entry for a group of resources.
export { Cluster } from "./Cluster.ts";
export type { ClusterClass } from "./Cluster.ts";

// Custom pages — the app-facing door for anything that isn't a Resource.
export { AdminPage } from "./pages/AdminPage.ts";
export type { AdminPageClass } from "./pages/AdminPage.ts";

// The contribution surface. Packages push into the `admin.panel` binding rather
// than importing these types; they're exported for app-authored plugins.
export type {
  AdminPanelHost,
  AdminPlugin,
  PageContribution,
  ConsoleContribution,
  ConsoleTab,
  ConsoleColumn,
  ConsoleAction,
  ConsoleHeaderAction,
  ConsoleRow,
  WidgetContribution,
  NavContribution,
  PanelSearchProvider,
  SearchHit,
  TopbarSlot,
  UserMenuContribution,
  PanelPageClass,
} from "./plugin.ts";
export type { AdminAuthorizer } from "./support/ability.ts";

export {
  Column,
  text,
  toggleColumn,
  imageColumn,
  colorColumn,
  iconColumn,
  selectColumn,
  textInputColumn,
} from "./table/Column.ts";
export type {
  BadgeTone,
  CellAlign,
  ColumnKind,
  ColumnOption,
  RenderableCell,
  SummaryKind,
  ColumnSummary,
  SummaryResult,
} from "./table/Column.ts";

export { Tab, tab } from "./table/Tab.ts";

export { Group, group } from "./table/Group.ts";

export {
  Filter,
  selectFilter,
  textFilter,
  ternaryFilter,
  queryBuilder,
  parseRuleTree,
  ruleTreeIsEmpty,
  describeRuleTree,
} from "./table/Filter.ts";
export type { QueryRule } from "./table/Filter.ts";

// Query-builder constraints — what a build-your-own filter may compare.
export {
  Constraint,
  textConstraint,
  numberConstraint,
  dateConstraint,
  booleanConstraint,
  selectConstraint,
} from "./table/Constraint.ts";
export type {
  ConstraintKind,
  ConstraintOperator,
  ConstraintOption,
  Conjunction,
} from "./table/Constraint.ts";
export type { FilterType, FilterOption, FilterApply } from "./table/Filter.ts";

// Dashboard widgets — stat rows, charts and small tables.
export {
  Stat,
  StatsWidget,
  stat,
  statsWidget,
  ChartWidget,
  chartWidget,
  TableWidget,
  tableWidget,
  widgetPollInterval,
} from "./widgets/Widget.ts";
export { renderWidgets } from "./widgets/render.tsx";
export type {
  WidgetTone,
  StatsResolver,
  ChartType,
  ChartData,
  ChartDataset,
  ChartResolver,
  TableWidgetColumn,
  TableRowsResolver,
  DashboardWidget,
} from "./widgets/Widget.ts";

export { RelationManager, hasMany, belongsToMany } from "./relations/RelationManager.ts";
export type { RelationKind, PivotColumn } from "./relations/RelationManager.ts";

// Actions — per-row, above the table, and over a selection.
export {
  Action,
  ActionGroup,
  action,
  actionGroup,
  flattenActions,
  viewAction,
  editAction,
  deleteAction,
  createAction,
  replicateAction,
  impersonateAction,
  bulkEditAction,
  bulkDeleteAction,
  restoreAction,
  forceDeleteAction,
  bulkRestoreAction,
  bulkForceDeleteAction,
  exportAction,
  bulkExportAction,
  importAction,
  importCsv,
  IMPORT_ROW_LIMIT,
  MAPPING_FIELD_PREFIX,
  toCsv,
  parseCsv,
  guessColumnMapping,
  renderAction,
  renderActionGroup,
  renderActionMenuItem,
} from "./actions/index.ts";
export { ImportRecordsJob, runQueuedImport, dispatchImport } from "./actions/ImportRecordsJob.ts";
export type { ImportRecordsPayload } from "./actions/ImportRecordsJob.ts";
export type {
  ActionColor,
  ActionContext,
  ActionHandler,
  ActionItem,
  ActionPage,
  ActionVisible,
  ImportResult,
} from "./actions/index.ts";

// Infolist (View page) building blocks — read-only schemas.
export {
  Entry,
  textEntry,
  iconEntry,
  imageEntry,
  colorEntry,
  codeEntry,
  keyValueEntry,
  repeatableEntry,
  Section,
  section,
} from "./infolist/index.ts";
export type {
  InfolistComponent,
  EntryDisplay,
  EntryKind,
  EntrySize,
  EntryWeight,
} from "./infolist/index.ts";

// Form (Create/Edit page) building blocks — editable schemas.
export {
  Field,
  textInput,
  textarea,
  select,
  checkbox,
  toggle,
  radio,
  checkboxList,
  datePicker,
  dateTimePicker,
  timePicker,
  colorPicker,
  hidden,
  tagsInput,
  keyValue,
  fileUpload,
  mediaPicker,
  slider,
  toggleButtons,
  codeEditor,
  markdownEditor,
  richEditor,
  repeater,
  builder,
  customField,
  BuilderBlock,
  builderBlock,
  FormSection,
  formSection,
  isFormSection,
  flattenFields,
  toFormSections,
  toFormLayout,
  FormTab,
  FormTabs,
  formTab,
  formTabs,
  WizardStep,
  Wizard,
  wizardStep,
  wizard,
  fieldset,
  Callout,
  callout,
  Prime,
  prime,
  primeHtml,
  primeImage,
  FormSplit,
  split,
  makeResourceForm,
} from "./form/index.ts";
export type {
  FieldType,
  FieldMode,
  FieldPredicate,
  SelectOption,
  FormComponent,
  FormBlock,
  CalloutTone,
  PrimeKind,
  ResourceFormClass,
} from "./form/index.ts";

export type { AdminConfigShape, AdminAuthConfig, UserMenu, UserMenuItem } from "./config.ts";
export { AdminConfig, DEFAULT_ADMIN_CONFIG } from "./config.ts";
// The auth pages themselves live behind the `@zerotal/admin/auth` subpath so the
// `@zerotal/auth` dependency they pull in stays optional for the core package.

export { AdminProvider } from "./provider/AdminProvider.ts";
export { AdminGuardMiddleware } from "./provider/AdminGuardMiddleware.ts";
export { AdminAbilityMiddleware } from "./provider/AdminAbilityMiddleware.ts";

// UI building blocks (for custom pages / theming).
export { AdminLayout, makeAdminLayout } from "./ui/AdminLayout.tsx";
export { Icon } from "./ui/icons.tsx";
export { adminHead, adminTokensCss, adminTailwindConfig, THEME_STORAGE_KEY } from "./theme.ts";
export type { AdminThemeConfig } from "./theme.ts";

// Pages (for advanced customization / custom routing).
export { DashboardPage, makeDashboardPage } from "./pages/DashboardPage.tsx";
export { SearchPage, makeSearchPage } from "./pages/SearchPage.tsx";
export { NotificationsPage, makeNotificationsPage } from "./pages/NotificationsPage.tsx";
export type { AdminNotification, NotificationProvider } from "./notifications.ts";
export { NOTIFICATION_CHANNEL, NOTIFICATION_EVENT } from "./notifications.ts";
export { ResourceListPage, makeResourceListPage } from "./pages/ResourceListPage.tsx";
export { RecordViewPage, makeRecordViewPage } from "./pages/RecordViewPage.tsx";
export { ResourceFormPage, registerResourceForm } from "./pages/ResourceFormPage.tsx";
export { ConsolePage, makeConsolePage } from "./pages/ConsolePage.tsx";
export type { FormModeConfig } from "./pages/ResourceFormPage.tsx";

// ── Media library ────────────────────────────────────────────────────────────
export { MediaPage, makeMediaPage } from "./pages/MediaPage.tsx";
export type { MediaItem, MediaProvider, StoreMediaOptions, UploadedFileLike } from "./media.ts";
export {
  isImage,
  isUpload,
  formatSize,
  mediaPath,
  mediaUrl,
  resolveMediaSrc,
  storeMedia,
  deleteMedia,
} from "./media.ts";
export { databaseMedia } from "./databaseMedia.ts";
export type { DatabaseMediaOptions } from "./databaseMedia.ts";

// ── Saved views ──────────────────────────────────────────────────────────────
export type { SavedView, SavedViewProvider } from "./savedViews.ts";
export { VIEW_PARAMS, viewQuery, viewIsActive } from "./savedViews.ts";

// ── Record history ───────────────────────────────────────────────────────────
export type { HistoryEntry, HistoryChange, HistoryOptions } from "./history.ts";
export { recordHistory, revertPayload } from "./history.ts";

// ── Impersonation ────────────────────────────────────────────────────────────
export {
  IMPERSONATOR_KEY,
  isImpersonating,
  impersonatedName,
  startImpersonating,
  stopImpersonating,
} from "./impersonation.ts";

// ── Environment indicator ────────────────────────────────────────────────────
export { environmentIndicator } from "./ui/environmentIndicator.tsx";
export type { EnvironmentIndicatorOptions } from "./ui/environmentIndicator.tsx";

// ── Spreadsheet export ───────────────────────────────────────────────────────
export { toXlsx } from "./actions/xlsx.ts";
export type { ExportFormat } from "./actions/transfer.ts";

// ── Roles & permissions ──────────────────────────────────────────────────────
export { RolesPage, makeRolesPage } from "./pages/RolesPage.tsx";
export type { Role, Permission, RoleProvider } from "./roles.ts";
export { panelPermissions, groupPermissions, roleHas } from "./roles.ts";

// ── Dashboard layout ─────────────────────────────────────────────────────────
export type { DashboardLayout, DashboardLayoutStore } from "./dashboardLayout.ts";
export { EMPTY_LAYOUT, applyLayout, moveKey, reconcile } from "./dashboardLayout.ts";
export { authRoles } from "./authRoles.ts";
export type { AuthRolesOptions } from "./authRoles.ts";
