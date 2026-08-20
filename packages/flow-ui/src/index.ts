// ── @zerotal/flow-ui public API ─────────────────────────────────────────────
//
// Themeable components for Flow. Styled wrappers compose the
// accessible headless primitives from @zerotal/flow; classes are driven by
// token-backed `gva` variants (see theme.css). Re-exports the flow headless
// primitives too, so an app can import everything from one place.

// Provider (registers the flow:list / flow:add / flow:init CLI commands)
export { FlowUiProvider } from "./provider/FlowUiProvider.ts";

// Registry (the manifest behind `bun zt flow:add`)
export { COMPONENTS, UTILS, findComponent } from "./registry.ts";
export type { ComponentEntry, UtilEntry } from "./registry.ts";

// Utilities
export { cn } from "./utils/cn.ts";
export type { ClassValue } from "./utils/cn.ts";
export { gva } from "./utils/gva.ts";
export type { GvaConfig, GvaProps } from "./utils/gva.ts";

// Styled components
export { Button, buttonVariants } from "./components/Button.tsx";
export type { ButtonProps } from "./components/Button.tsx";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./components/Card.tsx";
export type { CardElementProps } from "./components/Card.tsx";
export { Input } from "./components/Input.tsx";
export type { InputProps } from "./components/Input.tsx";
export { Textarea } from "./components/Textarea.tsx";
export type { TextareaProps } from "./components/Textarea.tsx";
export { Label } from "./components/Label.tsx";
export type { LabelProps } from "./components/Label.tsx";
export { Badge, badgeVariants } from "./components/Badge.tsx";
export type { BadgeProps } from "./components/Badge.tsx";
export { Separator } from "./components/Separator.tsx";
export type { SeparatorProps } from "./components/Separator.tsx";
export { Skeleton } from "./components/Skeleton.tsx";
export type { SkeletonProps } from "./components/Skeleton.tsx";
export { Avatar } from "./components/Avatar.tsx";
export type { AvatarProps } from "./components/Avatar.tsx";

// Styled restyles of the headless / native primitives (token-themed wrappers).
export { Switch } from "./components/Switch.tsx";
export type { SwitchProps } from "./components/Switch.tsx";
export { Checkbox } from "./components/Checkbox.tsx";
export type { CheckboxProps } from "./components/Checkbox.tsx";
export { Select } from "./components/Select.tsx";
export type { SelectProps, SelectOption } from "./components/Select.tsx";
export { RadioGroup } from "./components/RadioGroup.tsx";
export type { RadioGroupProps, RadioOption } from "./components/RadioGroup.tsx";
export { Dialog } from "./components/Dialog.tsx";
export type { DialogProps } from "./components/Dialog.tsx";
export { Sheet } from "./components/Sheet.tsx";
export type { SheetProps } from "./components/Sheet.tsx";
export {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "./components/DropdownMenu.tsx";
export type {
  DropdownMenuProps,
  DropdownMenuItemProps,
  DropdownMenuLabelProps,
  DropdownMenuSeparatorProps,
  DropdownMenuShortcutProps,
} from "./components/DropdownMenu.tsx";
export { Tabs } from "./components/Tabs.tsx";
export type { TabsProps, TabItem } from "./components/Tabs.tsx";
export { Alert, AlertTitle, AlertDescription, alertVariants } from "./components/Alert.tsx";
export type { AlertProps, AlertTextProps } from "./components/Alert.tsx";
export { Tooltip } from "./components/Tooltip.tsx";
export type { TooltipProps } from "./components/Tooltip.tsx";
export { Table } from "./components/Table.tsx";
export type { TableProps, TableColumn, TableGroup } from "./components/Table.tsx";

// The theme as a `<head>` payload — the build-free path to the same design
// tokens `theme.css` provides. Every panel Zerotal ships is themed from here.
export {
  flowUiHead,
  flowTokensCss,
  flowTailwindConfig,
  THEME_STORAGE_KEY,
  THEME_TOGGLE_SCRIPT,
} from "./theme.ts";
export type { FlowUiThemeConfig } from "./theme.ts";

// The flow headless primitives flow-ui does not restyle, re-exported so
// `@zerotal/flow-ui` stays a single import surface. Style these with theme tokens
// via their class props.
//
// Everything flow-ui ships a themed version of is deliberately absent here —
// Switch, Checkbox, Select, RadioGroup, Label, Accordion, Popover, Combobox,
// Disclosure and Field all resolve to the styled component, which is what a
// package promising themed components should give you.
export { Listbox, Fieldset, Legend, Description } from "@zerotal/flow";

// ── Overlays & navigation ────────────────────────────────────────────────────
export { Popover, popoverSurface } from "./components/Popover.tsx";
export type { PopoverProps, PopoverAlign, PopoverSide } from "./components/Popover.tsx";
export { HoverCard } from "./components/HoverCard.tsx";
export type { HoverCardProps } from "./components/HoverCard.tsx";
export { AlertDialog } from "./components/AlertDialog.tsx";
export type { AlertDialogProps } from "./components/AlertDialog.tsx";
export { Command } from "./components/Command.tsx";
export type { CommandProps, CommandItem } from "./components/Command.tsx";
export { ContextMenu } from "./components/ContextMenu.tsx";
export type { ContextMenuProps, ContextMenuItem } from "./components/ContextMenu.tsx";
export { Menubar } from "./components/Menubar.tsx";
export type { MenubarProps, MenubarMenu } from "./components/Menubar.tsx";
export { NavigationMenu } from "./components/NavigationMenu.tsx";
export type {
  NavigationMenuProps,
  NavigationMenuItem,
  NavigationPanelLink,
} from "./components/NavigationMenu.tsx";
export { Sidebar, isActive } from "./components/Sidebar.tsx";
export type { SidebarProps, SidebarGroup, SidebarItem } from "./components/Sidebar.tsx";
export { Breadcrumb } from "./components/Breadcrumb.tsx";
export type { BreadcrumbProps, BreadcrumbItem } from "./components/Breadcrumb.tsx";
export { Pagination, paginationRange } from "./components/Pagination.tsx";
export type { PaginationProps } from "./components/Pagination.tsx";

// ── Forms ────────────────────────────────────────────────────────────────────
export { Field } from "./components/Field.tsx";
export type { FieldProps } from "./components/Field.tsx";
export { InputGroup } from "./components/InputGroup.tsx";
export type { InputGroupProps } from "./components/InputGroup.tsx";
export { InputOTP } from "./components/InputOTP.tsx";
export type { InputOTPProps } from "./components/InputOTP.tsx";
export { Combobox } from "./components/Combobox.tsx";
export type { ComboboxProps, ComboboxOption } from "./components/Combobox.tsx";
export { Slider } from "./components/Slider.tsx";
export type { SliderProps } from "./components/Slider.tsx";
export { Toggle, ToggleGroup, toggleVariants } from "./components/Toggle.tsx";
export type { ToggleProps, ToggleGroupProps, ToggleOption } from "./components/Toggle.tsx";
export { ButtonGroup } from "./components/ButtonGroup.tsx";
export type { ButtonGroupProps } from "./components/ButtonGroup.tsx";
export { Calendar, monthGrid, isoDay, shiftMonth } from "./components/Calendar.tsx";
export type { CalendarProps, CalendarEvent } from "./components/Calendar.tsx";
export { DatePicker, formatDay } from "./components/DatePicker.tsx";
export type { DatePickerProps } from "./components/DatePicker.tsx";

// ── Feedback & status ────────────────────────────────────────────────────────
export { Toaster } from "./components/Toast.tsx";
export type { ToasterProps, ToastPosition } from "./components/Toast.tsx";
export { Progress } from "./components/Progress.tsx";
export type { ProgressProps } from "./components/Progress.tsx";
export { Spinner, spinnerVariants } from "./components/Spinner.tsx";
export type { SpinnerProps } from "./components/Spinner.tsx";
export { Empty } from "./components/Empty.tsx";
export type { EmptyProps } from "./components/Empty.tsx";
export { Icon } from "./components/Icon.tsx";
export type { IconProps } from "./components/Icon.tsx";
export { registerIcons } from "./icons/loader.ts";
export type { IconBody } from "./icons/loader.ts";
export { isIconName } from "./icons/registry.ts";
export type { IconName, CustomIconName, CustomIconRegistry } from "./icons/registry.ts";
export { Kbd, KbdMod } from "./components/Kbd.tsx";
export type { KbdProps } from "./components/Kbd.tsx";

// ── Layout & content ─────────────────────────────────────────────────────────
export { Accordion } from "./components/Accordion.tsx";
export type { AccordionProps, AccordionItem } from "./components/Accordion.tsx";
export { Collapsible } from "./components/Collapsible.tsx";
export type { CollapsibleProps } from "./components/Collapsible.tsx";
export { ScrollArea } from "./components/ScrollArea.tsx";
export type { ScrollAreaProps } from "./components/ScrollArea.tsx";
export { Resizable } from "./components/Resizable.tsx";
export type { ResizableProps } from "./components/Resizable.tsx";
export { Carousel } from "./components/Carousel.tsx";
export type { CarouselProps } from "./components/Carousel.tsx";
export { AspectRatio } from "./components/AspectRatio.tsx";
export type { AspectRatioProps } from "./components/AspectRatio.tsx";
export { Item } from "./components/Item.tsx";
export type { ItemProps } from "./components/Item.tsx";
export { Chart } from "./components/Chart.tsx";
export type { ChartProps, ChartType, ChartDataset } from "./components/Chart.tsx";
export {
  Prose,
  H1,
  H2,
  H3,
  H4,
  P,
  Lead,
  Muted,
  Small,
  Code,
  Blockquote,
  List,
} from "./components/Typography.tsx";
export type { ProseProps, TextProps } from "./components/Typography.tsx";
