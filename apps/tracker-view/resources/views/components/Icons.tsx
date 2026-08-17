import type { FC } from "zerotal/view";

/**
 * The same glyphs the Inertia build draws, as plain SVG.
 *
 * Copied rather than shared: one is a React component tree, this is a string of
 * HTML, and there is no runtime both can import. The `viewBox`, stroke width and
 * path data are identical, so the two builds' rails and tabs line up pixel for
 * pixel — which is the whole point of the side-by-side comparison.
 */
const Svg: FC<{ class?: string | undefined; children?: unknown }> = ({ class: cls, children }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class={cls}
  >
    {children}
  </svg>
);

type IconProps = { class?: string | undefined };

export const UserIcon: FC<IconProps> = ({ class: cls }) => (
  <Svg class={cls}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </Svg>
);

export const ShieldIcon: FC<IconProps> = ({ class: cls }) => (
  <Svg class={cls}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);

export const SunIcon: FC<IconProps> = ({ class: cls }) => (
  <Svg class={cls}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

export const GlobeIcon: FC<IconProps> = ({ class: cls }) => (
  <Svg class={cls}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" />
  </Svg>
);

export const ChartIcon: FC<IconProps> = ({ class: cls }) => (
  <Svg class={cls}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Svg>
);

export const ProjectsIcon: FC<IconProps> = ({ class: cls }) => (
  <Svg class={cls}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M8.5 9v6M12 9v3.5M15.5 9v5" />
  </Svg>
);

export const ClockIcon: FC<IconProps> = ({ class: cls }) => (
  <Svg class={cls}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.2l3.2 2" />
  </Svg>
);
