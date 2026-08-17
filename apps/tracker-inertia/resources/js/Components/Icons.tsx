import type { SVGProps } from "react";

/**
 * The handful of icons this starter needs, inlined.
 *
 * They are plain `stroke="currentColor"` SVGs, so they inherit text colour and
 * follow the theme with no extra wiring — and no icon package to install. Reach
 * for a real icon set once you outgrow these.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
    </Svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m20 6-11 11-5-5" />
    </Svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.6.8l1 1.2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Svg>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m12 3 9 5-9 5-9-5 9-5z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 16.5 9 5 9-5" />
    </Svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}

export function DatabaseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 6c0-1.7 4-3 9-3s9 1.3 9 3-4 3-9 3-9-1.3-9-3z" />
      <path d="M3 6v6c0 1.7 4 3 9 3s9-1.3 9-3V6" />
      <path d="M3 12v6c0 1.7 4 3 9 3s9-1.3 9-3v-6" />
    </Svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.2 2" />
    </Svg>
  );
}

export function TerminalIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5 8 4 4-4 4M12 16h7" />
      <rect x="2" y="3" width="20" height="18" rx="2.5" />
    </Svg>
  );
}

/* ── Navigation and account ─────────────────────────────────────────────────── */

/** A board with columns — the Projects section of the sidebar. */
export function ProjectsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8.5 9v6M12 9v3.5M15.5 9v5" />
    </Svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </Svg>
  );
}

export function LogOutIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H9" />
      <path d="M13 12h8M17.5 8.5 21 12l-3.5 3.5" />
    </Svg>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" />
    </Svg>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Svg>
  );
}

export function PaperclipIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 11.5 12.4 19a4.5 4.5 0 0 1-6.4-6.4l7.9-7.9a3 3 0 0 1 4.2 4.2l-7.9 7.9a1.5 1.5 0 0 1-2.1-2.1l7.2-7.2" />
    </Svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}
