/**
 * The glyphs Components/Icon.vue draws — the same set as the React starter's Icon.tsx.
 * Outline icons are stroked with `currentColor`; the brand marks carry their own fill.
 */
export type IconName =
  | "sun"
  | "moon"
  | "menu"
  | "close"
  | "arrow-right"
  | "alert"
  | "info"
  | "check"
  | "folder"
  | "layers"
  | "shield"
  | "database"
  | "clock"
  | "bolt"
  | "terminal"
  | "mail"
  | "home"
  | "grid"
  | "settings"
  | "log-out"
  | "user"
  | "lock"
  | "key"
  | "fingerprint"
  | "monitor"
  | "phone"
  | "palette"
  | "trash"
  | "plus"
  | "search"
  | "pencil"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "laptop"
  | "external-link"
  | "github"
  | "google";

export const ICONS: Record<IconName, { brand: boolean; body: string }> = {
  sun: {
    brand: false,
    body: `<circle cx="12" cy="12" r="4" /> <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />`,
  },
  moon: { brand: false, body: `<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />` },
  menu: { brand: false, body: `<path d="M4 7h16M4 12h16M4 17h16" />` },
  close: { brand: false, body: `<path d="M18 6 6 18M6 6l12 12" />` },
  "arrow-right": { brand: false, body: `<path d="M5 12h14M13 6l6 6-6 6" />` },
  alert: {
    brand: false,
    body: `<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />`,
  },
  info: {
    brand: false,
    body: `<path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" />`,
  },
  check: { brand: false, body: `<path d="m20 6-11 11-5-5" />` },
  folder: {
    brand: false,
    body: `<path d="M3 7a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.6.8l1 1.2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />`,
  },
  layers: {
    brand: false,
    body: `<path d="m12 3 9 5-9 5-9-5 9-5z" /> <path d="m3 12 9 5 9-5" /> <path d="m3 16.5 9 5 9-5" />`,
  },
  shield: {
    brand: false,
    body: `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /> <path d="m9 12 2 2 4-4" />`,
  },
  database: {
    brand: false,
    body: `<path d="M3 6c0-1.7 4-3 9-3s9 1.3 9 3-4 3-9 3-9-1.3-9-3z" /> <path d="M3 6v6c0 1.7 4 3 9 3s9-1.3 9-3V6" /> <path d="M3 12v6c0 1.7 4 3 9 3s9-1.3 9-3v-6" />`,
  },
  clock: { brand: false, body: `<circle cx="12" cy="12" r="9" /> <path d="M12 7v5.2l3.2 2" />` },
  bolt: { brand: false, body: `<path d="m13 2-9 12h7l-1 8 9-12h-7l1-8z" />` },
  terminal: {
    brand: false,
    body: `<path d="m5 8 4 4-4 4M12 16h7" /> <rect x="2" y="3" width="20" height="18" rx="2.5" />`,
  },
  mail: {
    brand: false,
    body: `<rect x="2.5" y="5" width="19" height="14" rx="2.5" /> <path d="m3 7 8.1 5.4a1.6 1.6 0 0 0 1.8 0L21 7" />`,
  },
  home: {
    brand: false,
    body: `<path d="M3 10.5 12 3l9 7.5" /> <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />`,
  },
  grid: {
    brand: false,
    body: `<rect x="3" y="3" width="7" height="7" rx="1.5" /> <rect x="14" y="3" width="7" height="7" rx="1.5" /> <rect x="3" y="14" width="7" height="7" rx="1.5" /> <rect x="14" y="14" width="7" height="7" rx="1.5" />`,
  },
  settings: {
    brand: false,
    body: `<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /> <circle cx="16" cy="6" r="2" /> <circle cx="10" cy="12" r="2" /> <circle cx="18" cy="18" r="2" />`,
  },
  "log-out": {
    brand: false,
    body: `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /> <path d="m16 17 5-5-5-5M21 12H9" />`,
  },
  user: { brand: false, body: `<circle cx="12" cy="8" r="4" /> <path d="M4 21a8 8 0 0 1 16 0" />` },
  lock: {
    brand: false,
    body: `<rect x="4" y="11" width="16" height="10" rx="2" /> <path d="M8 11V7a4 4 0 0 1 8 0v4" />`,
  },
  key: {
    brand: false,
    body: `<circle cx="7.5" cy="15.5" r="4.5" /> <path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2" />`,
  },
  fingerprint: {
    brand: false,
    body: `<path d="M12 11v3a8 8 0 0 1-1.5 4.7" /> <path d="M8.5 9.5a4 4 0 0 1 7 2.5v1.5a12 12 0 0 1-1 4.8" /> <path d="M5 10a7 7 0 0 1 13.4-2.8" /> <path d="M19 12v1.5a16 16 0 0 1-.6 4.3" /> <path d="M5 14v-1a7 7 0 0 1 .3-2" /> <path d="M6.5 18.5A12 12 0 0 0 8 14v-2" />`,
  },
  monitor: {
    brand: false,
    body: `<rect x="2.5" y="4" width="19" height="13" rx="2" /> <path d="M8 21h8M12 17v4" />`,
  },
  phone: {
    brand: false,
    body: `<rect x="6" y="2.5" width="12" height="19" rx="2.5" /> <path d="M11 18h2" />`,
  },
  palette: {
    brand: false,
    body: `<path d="M12 21a9 9 0 1 1 9-9c0 2.5-2 3.5-3.5 3.5H15a2 2 0 0 0-1.5 3.3A1.4 1.4 0 0 1 12 21z" /> <circle cx="7.5" cy="11" r="1" /> <circle cx="10.5" cy="7" r="1" /> <circle cx="15" cy="7.5" r="1" />`,
  },
  trash: {
    brand: false,
    body: `<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3" />`,
  },
  plus: { brand: false, body: `<path d="M12 5v14M5 12h14" />` },
  search: { brand: false, body: `<circle cx="11" cy="11" r="7" /> <path d="m20 20-3.5-3.5" />` },
  pencil: {
    brand: false,
    body: `<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /> <path d="m13.5 6.5 4 4" />`,
  },
  "chevron-down": { brand: false, body: `<path d="m6 9 6 6 6-6" />` },
  "chevron-left": { brand: false, body: `<path d="m15 18-6-6 6-6" />` },
  "chevron-right": { brand: false, body: `<path d="m9 18 6-6-6-6" />` },
  laptop: {
    brand: false,
    body: `<rect x="4" y="5" width="16" height="11" rx="1.5" /> <path d="M2 19h20" />`,
  },
  "external-link": {
    brand: false,
    body: `<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />`,
  },
  github: {
    brand: true,
    body: `<path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />`,
  },
  google: {
    brand: true,
    body: `<path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" /> <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" /> <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8z" /> <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />`,
  },
};
