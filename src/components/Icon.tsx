/**
 * The icon set.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * It replaces emoji. The module used `🔍 🧱 ⚠ ⌛ 🏢 🎓 ☀ ☾ ⌕ ⊘ ↳ →` as its icon
 * vocabulary, and the §8 specs propose more. Emoji are the single loudest
 * "this was assembled quickly" signal available in a modern UI, and the reason
 * is mechanical rather than aesthetic: they render in the OS emoji font, so
 * they are full-colour on a monochrome page, differently sized and
 * differently baselined on every platform, and they cannot inherit
 * `currentColor` — a "disabled" glyph stays cheerfully coloured next to grey
 * text. Two of the ones in use were worse than that: `⌕` (U+2315) has no glyph
 * in Segoe UI and rendered as a tofu box — as the SEARCH icon, in the rail
 * button and inside the search input — and `👨‍🎓` is a ZWJ sequence that falls
 * apart into two separate emoji on older Windows builds.
 *
 * ── Why it lives in core ───────────────────────────────────────────────────
 * It replaces emoji EVERYWHERE at once. This package used them inside the
 * components five modules are supposed to render identically, and M15 had
 * another dozen of its own, so the set moved here rather than being written
 * twice. "The platform looks like one product rather than nineteen student
 * projects stapled together" is a promise about vocabulary as much as about
 * colour, and an icon set each module draws for itself is how a check mark
 * comes to mean two things in two places.
 *
 * ── Shape rules, so a later addition matches ────────────────────────────────
 * 24×24 viewBox, 1.5px stroke, round caps and joins, no fills, geometry on a
 * 2px grid, and `currentColor` throughout — an icon must take the colour of
 * the text beside it, including when that text is a disabled 4:1 grey or a
 * `contested` red.
 *
 * ── Accessibility ──────────────────────────────────────────────────────────
 * Default `aria-hidden`. An icon is decoration unless it is the ONLY content
 * of a control, and in that case the control carries the label, not the glyph
 * — pass `title` only for the rare standalone-meaning case. This is why the
 * component makes `aria-hidden` the default rather than an option you remember.
 */

import type { SVGProps } from "react";

/*
  Path data only. A record rather than 40 exported components, on purpose: the
  module registry, the rail sections and the empty states all need to pick an
  icon by NAME from data, and a record makes that a lookup instead of a switch
  somebody forgets to extend.
*/
const PATHS = {
  /* ── navigation and chrome ─────────────────────────────────────────── */
  search: "M10.5 3.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20.5 20.5l-5-5",
  command:
    "M15 6a3 3 0 1 1 3 3h-3V6ZM9 6a3 3 0 1 0-3 3h3V6ZM15 18a3 3 0 1 0 3-3h-3v3ZM9 18a3 3 0 1 1-3-3h3v3ZM9 9h6v6H9z",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6L6 18",
  arrowRight: "M4.5 12h15M13 5.5l6.5 6.5-6.5 6.5",
  arrowLeft: "M19.5 12h-15M11 18.5 4.5 12 11 5.5",
  chevronRight: "M9.5 5.5l6.5 6.5-6.5 6.5",
  chevronDown: "M5.5 9.5l6.5 6.5 6.5-6.5",
  chevronUp: "M5.5 14.5 12 8l6.5 6.5",
  externalLink: "M14 4h6v6M20 4l-8.5 8.5M18 14.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5",
  link: "M9.5 14.5 14.5 9.5M11 6.5l1.8-1.8a4 4 0 0 1 5.7 5.7L16.7 12M13 17.5l-1.8 1.8a4 4 0 0 1-5.7-5.7L7.3 12",

  /* ── theme ─────────────────────────────────────────────────────────── */
  sun: "M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM12 1.5v2M12 20.5v2M3.9 3.9l1.4 1.4M18.7 18.7l1.4 1.4M1.5 12h2M20.5 12h2M3.9 20.1l1.4-1.4M18.7 5.3l1.4-1.4",
  moon: "M20 14.4A8.5 8.5 0 0 1 9.6 4 8.5 8.5 0 1 0 20 14.4Z",
  /* "follow my system" — a screen, because that is what the setting points at.
     This was `compass` for one build and read as a target icon beside the
     wordmark: a theme control has to say THEME at a glance or it is a mystery
     button in the top corner. */
  monitor: "M3.5 5h17v11h-17V5ZM9 20h6M12 16v4",

  /* ── verification and state ────────────────────────────────────────── */
  check: "M4.5 12.5l4.5 4.5L19.5 6.5",
  checkCircle: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM8.5 12.2l2.4 2.4 4.6-4.6",
  alert: "M12 4.2 2.8 20h18.4L12 4.2ZM12 9.5v4.5M12 17h.01",
  info: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 11v5.5M12 7.8h.01",
  scales:
    "M12 4.5v15M6.5 19.5h11M4 8.5h16M4 8.5 1.5 14h5L4 8.5ZM20 8.5 17.5 14h5L20 8.5ZM8 4.5h8",
  clock: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 7.5V12l3.2 2",
  slash: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM6 18 18 6",
  refresh: "M20 6v5h-5M4 18v-5h5M19.4 13a7.5 7.5 0 0 1-12.6 3.3L4 13.5M4.6 11a7.5 7.5 0 0 1 12.6-3.3L20 10.5",

  /* ── the domain ────────────────────────────────────────────────────── */
  building:
    "M4 20.5V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15.5M15 9.5h4a1 1 0 0 1 1 1v10M2.5 20.5h19M7.5 8h3.5M7.5 12h3.5M7.5 16h3.5",
  student: "M2.5 8.5 12 4.5l9.5 4-9.5 4-9.5-4ZM6.5 10.2V16c0 1.7 2.5 3 5.5 3s5.5-1.3 5.5-3v-5.8M21.5 8.5v6",
  quote:
    "M9.5 6.5C6.9 7.7 5.5 10 5.5 13v4.5h4.5V12H7.8c.2-1.6 1-2.7 2.5-3.4l-.8-2.1ZM19 6.5c-2.6 1.2-4 3.5-4 6.5v4.5h4.5V12h-2.2c.2-1.6 1-2.7 2.5-3.4L19 6.5Z",
  document: "M6 3.5h7.5L19 9v11.5H6V3.5ZM13.5 3.5V9H19M9 13h7M9 16.5h5",
  target:
    "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z",
  listChecks: "M4 6.5l1.8 1.8L9 5M4 17.5l1.8 1.8L9 16M12 7h8M12 12h8M12 17.5h8",
  zap: "M13.5 2.5 5 13.5h5.5l-1 8 8.5-11h-5.5l1-8Z",
  star: "M12 3.5l2.6 5.4 5.9.85-4.25 4.15 1 5.9L12 17l-5.25 2.8 1-5.9L3.5 9.75l5.9-.85L12 3.5Z",
  compass: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM15.5 8.5l-2 5-5 2 2-5 5-2Z",
  layers: "M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5M3 17l9 5 9-5",
  chart: "M4 20.5V10M9.5 20.5V4M15 20.5v-7M20.5 20.5V8",
  users:
    "M15.5 20v-1.5a4 4 0 0 0-4-4h-4a4 4 0 0 0-4 4V20M9.5 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7M21 20v-1.5a4 4 0 0 0-3-3.9M16 4.2a3.5 3.5 0 0 1 0 6.8",
  mic: "M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3ZM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3M9 20.5h6",
  code: "M8.5 8 4.5 12l4 4M15.5 8l4 4-4 4",
  gitBranch: "M6.5 4v9M6.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM17.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM17.5 9v1.5a4 4 0 0 1-4 4H6.5",
  shield: "M12 3 4.5 6v6c0 4.2 3 7.4 7.5 9 4.5-1.6 7.5-4.8 7.5-9V6L12 3ZM9 12l2.2 2.2L15.5 10",
  /* The skill graph: nodes and the edges between them. A literal brain outline
     was tried first and is unreadable at 18px — the two lobes collapse into a
     pair of grey blobs — and it is also the wrong idea. M04 models prerequisite
     structure, which is a graph, not an organ. */
  graph:
    "M5 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM19 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 15a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6.4 7.6l4.2 3.9M17.6 7.6 13.4 11.5M11 14.6 7.3 17.2M13.2 14.7l3.5 2.5",
  calendar: "M4.5 6.5h15v13h-15v-13ZM8 3.5V7M16 3.5V7M4.5 11h15",
  sparkles:
    "M12 3.5 13.4 8l4.6 1.5L13.4 11 12 15.5 10.6 11 6 9.5 10.6 8 12 3.5ZM18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z",

  /* ── controls ──────────────────────────────────────────────────────── */
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  trash: "M4.5 7h15M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10.5 10.5v6M13.5 10.5v6",
  send: "M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4 17-6.5Z",
  copy: "M9 9h9.5a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1ZM15.5 6V4.5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1V14a1 1 0 0 0 1 1h1.5",
  thumbsUp:
    "M6.5 10.5H4a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h2.5v-9ZM6.5 10.5 11 3.5a2 2 0 0 1 2 2.4l-.7 3.6h5.6a2 2 0 0 1 2 2.4l-1.1 5.6a2 2 0 0 1-2 1.5H6.5v-9Z",
  cornerDownRight: "M6 5v7.5a2 2 0 0 0 2 2h10M15 11l3.5 3.5L15 18",
  keyboard:
    "M3 7h18v10H3V7ZM6.5 10.5h.01M9.5 10.5h.01M12.5 10.5h.01M15.5 10.5h.01M8 13.5h8",
  filter: "M4 6h16l-6 7v5.5l-4 1.5V13L4 6Z",
} as const;

export type IconName = keyof typeof PATHS;

/** Icon names, so a caller can be checked against the set at compile time. */
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function Icon({
  name,
  size = 16,
  title,
  className = "",
  strokeWidth = 1.5,
  ...rest
}: {
  name: IconName;
  /** Pixels. 16 beside body text, 20 in a control, 24 as a section marker. */
  size?: number;
  /**
   * Only when the icon carries meaning no nearby text carries. Adds a
   * `<title>` and drops `aria-hidden`; leave it off for decoration.
   */
  title?: string;
  className?: string;
  strokeWidth?: number;
} & Omit<SVGProps<SVGSVGElement>, "name" | "title" | "className">) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
      {...rest}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}

/**
 * The platform key, spelled the way the keyboard is actually labelled.
 *
 * The rail rendered `⌘K` literally, on Windows, where the key is Ctrl. The
 * handler always accepted both — only the label lied, which is the worst
 * version of the bug because it teaches the wrong shortcut.
 *
 * Read once at module load: a keyboard does not change mid-session, and
 * calling this per render would make every `<kbd>` a layout-thrash risk.
 */
export const IS_APPLE =
  typeof navigator !== "undefined" &&
  /mac|iphone|ipad|ipod/i.test(
    // `userAgentData` is Chromium-only and `platform` is deprecated but still
    // the only thing Safari and Firefox answer. Both, then, in that order.
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform ??
      "",
  );

export const MOD_KEY = IS_APPLE ? "⌘" : "Ctrl";
