/**
 * HubbaIcons — SkateHubba's custom glyph set.
 *
 * Grid: 24×24, 2px live-area padding (art sits inside 2–22), 1.75 stroke,
 * round caps/joins, 2px corner radius on boxes. Every coordinate lands on a
 * .25 step so strokes stay crisp at 20, 24 and 28px.
 *
 * Each glyph has an outline (inactive) and a filled (active) form. The
 * filled form is a solid body with interior detail knocked out through a
 * mask, so it reads on any background without hard-coding a colour.
 *
 * Pure data, no React, so the preview script can render the same paths.
 */

export type GlyphEl =
  | { t: "path"; d: string }
  | { t: "circle"; cx: number; cy: number; r: number }
  | { t: "rect"; x: number; y: number; w: number; h: number; rx: number; rot?: number };

/** A knockout element: "cut" removes from the filled body, "keep" paints it back. */
export type CutEl = GlyphEl & { mode?: "cut" | "keep"; width?: number; solid?: boolean };

export interface Glyph {
  outline: GlyphEl[];
  filled: { body: GlyphEl[]; cuts: CutEl[] };
}

export const STROKE = 1.75;

const deck: GlyphEl = { t: "rect", x: 9, y: 3.5, w: 6, h: 17, rx: 3, rot: 45 };
// Axles run across the deck; wheels poke out either side (top-down view).
const AXLES = "M4.85 12.65 11.35 19.15M12.65 4.85l6.5 6.5";
const WHEELS: [number, number][] = [
  [4.6, 12.4],
  [11.6, 19.4],
  [12.4, 4.6],
  [19.4, 11.6],
];

export const GLYPHS = {
  /** Home: house whose floor is a quarter-pipe transition. */
  home: {
    outline: [
      { t: "path", d: "M3.75 10.25 12 3.75l8.25 6.5V19a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5z" },
      { t: "path", d: "M8 20.5v-.5a4.5 4.5 0 0 1 4.5-4.5h3.75" },
    ],
    filled: {
      body: [{ t: "path", d: "M3.75 10.25 12 3.75l8.25 6.5V19a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5z" }],
      cuts: [{ t: "path", d: "M8 20.5v-.5a4.5 4.5 0 0 1 4.5-4.5h3.75", width: 2 }],
    },
  },
  /** Challenge: top-down deck with trucks, tilted for motion. */
  challenge: {
    outline: [deck, { t: "path", d: AXLES }, ...WHEELS.map(([cx, cy]) => ({ t: "circle" as const, cx, cy, r: 0.6 }))],
    filled: {
      body: [deck, { t: "path", d: AXLES }, ...WHEELS.map(([cx, cy]) => ({ t: "circle" as const, cx, cy, r: 0.6 }))],
      cuts: [{ t: "path", d: "M7.6 15.4l1 1M15.4 7.6l1 1", width: 1.25 }],
    },
  },
  /** Clips: a skate wheel with a play mark as the hub. */
  clips: {
    outline: [
      { t: "circle", cx: 12, cy: 12, r: 8.75 },
      { t: "path", d: "M10.25 9.15v5.7a.5.5 0 0 0 .76.43l4.6-2.85a.5.5 0 0 0 0-.86l-4.6-2.85a.5.5 0 0 0-.76.43z" },
    ],
    filled: {
      body: [{ t: "circle", cx: 12, cy: 12, r: 9.25 }],
      cuts: [
        { t: "circle", cx: 12, cy: 12, r: 6.75, width: 1.25 },
        {
          t: "path",
          d: "M10.25 9.15v5.7a.5.5 0 0 0 .76.43l4.6-2.85a.5.5 0 0 0 0-.86l-4.6-2.85a.5.5 0 0 0-.76.43z",
          solid: true,
          width: 1,
        },
      ],
    },
  },
  /** Map / spot: pin holding a ledge profile. */
  spot: {
    outline: [
      { t: "path", d: "M12 21.25s6.75-5.9 6.75-11.5a6.75 6.75 0 0 0-13.5 0c0 5.6 6.75 11.5 6.75 11.5z" },
      { t: "path", d: "M8.5 12.25h3.25v-3h3.75" },
    ],
    filled: {
      body: [{ t: "path", d: "M12 21.25s6.75-5.9 6.75-11.5a6.75 6.75 0 0 0-13.5 0c0 5.6 6.75 11.5 6.75 11.5z" }],
      cuts: [{ t: "path", d: "M8.5 12.25h3.25v-3h3.75", width: 2 }],
    },
  },
  /** Me: skater in a five-panel cap. */
  me: {
    outline: [
      { t: "circle", cx: 12, cy: 8.5, r: 3.75 },
      { t: "path", d: "M8.25 8.75h7.5l2.75 0" },
      { t: "path", d: "M4.75 20.5a7.25 7.25 0 0 1 14.5 0" },
    ],
    filled: {
      body: [
        { t: "circle", cx: 12, cy: 8.5, r: 4.5 },
        { t: "path", d: "M4.75 20.5a7.25 7.25 0 0 1 14.5 0z" },
        { t: "path", d: "M15.75 8.75h2.5" },
      ],
      cuts: [{ t: "path", d: "M7 8.75h8.25", width: 1.1 }],
    },
  },
  /** Notifications bell, same grid and terminals as the set. */
  bell: {
    outline: [
      { t: "path", d: "M6.25 9.5a5.75 5.75 0 0 1 11.5 0c0 4.75 2 6.5 2 6.5H4.25s2-1.75 2-6.5z" },
      { t: "path", d: "M10 19.5a2.25 2.25 0 0 0 4 0" },
    ],
    filled: {
      body: [
        { t: "path", d: "M6.25 9.5a5.75 5.75 0 0 1 11.5 0c0 4.75 2 6.5 2 6.5H4.25s2-1.75 2-6.5z" },
        { t: "path", d: "M10 19.5a2.25 2.25 0 0 0 4 0" },
      ],
      cuts: [],
    },
  },
  /** Settings: a skate bearing — you tune your setup. */
  settings: {
    outline: [
      { t: "circle", cx: 12, cy: 12, r: 8.75 },
      { t: "circle", cx: 12, cy: 12, r: 3 },
      { t: "circle", cx: 12, cy: 6.1, r: 1.1 },
      { t: "circle", cx: 17.1, cy: 9.05, r: 1.1 },
      { t: "circle", cx: 17.1, cy: 14.95, r: 1.1 },
      { t: "circle", cx: 12, cy: 17.9, r: 1.1 },
      { t: "circle", cx: 6.9, cy: 14.95, r: 1.1 },
      { t: "circle", cx: 6.9, cy: 9.05, r: 1.1 },
    ],
    filled: {
      body: [{ t: "circle", cx: 12, cy: 12, r: 9.25 }],
      cuts: [
        { t: "circle", cx: 12, cy: 12, r: 2.25, solid: true, width: 0 },
        { t: "circle", cx: 12, cy: 12, r: 5.9, width: 3.25 },
        ...[
          [12, 6.1],
          [17.1, 9.05],
          [17.1, 14.95],
          [12, 17.9],
          [6.9, 14.95],
          [6.9, 9.05],
        ].map(([cx, cy]) => ({ t: "circle" as const, cx, cy, r: 1.15, mode: "keep" as const, solid: true, width: 0 })),
      ],
    },
  },
} satisfies Record<string, Glyph>;

export type GlyphName = keyof typeof GLYPHS;

/** Serialise one element to SVG markup (used by the preview script and tests). */
export function elToSvg(el: GlyphEl, attrs = ""): string {
  switch (el.t) {
    case "path":
      return `<path d="${el.d}" ${attrs}/>`;
    case "circle":
      return `<circle cx="${el.cx}" cy="${el.cy}" r="${el.r}" ${attrs}/>`;
    case "rect":
      return `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="${el.rx}"${
        el.rot ? ` transform="rotate(${el.rot} 12 12)"` : ""
      } ${attrs}/>`;
  }
}

/** Full standalone SVG markup for a glyph. `id` must be unique per document. */
export function glyphToSvg(name: GlyphName, filled: boolean, id: string, size = 24, color = "currentColor"): string {
  const g: Glyph = GLYPHS[name];
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">`;
  if (!filled) {
    return `${head}<g stroke="${color}" stroke-width="${STROKE}">${g.outline.map((e) => elToSvg(e)).join("")}</g></svg>`;
  }
  const cuts = g.filled.cuts
    .map((c) => {
      const paint = c.mode === "keep" ? "white" : "black";
      const w = c.width ?? STROKE;
      return elToSvg(c, `fill="${c.solid ? paint : "none"}" stroke="${w ? paint : "none"}" stroke-width="${w}"`);
    })
    .join("");
  const body = g.filled.body
    .map((e) => elToSvg(e, `fill="${color}" stroke="${color}" stroke-width="${STROKE}"`))
    .join("");
  return `${head}<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="white"/>${cuts}</mask></defs><g mask="url(#${id})">${body}</g></svg>`;
}
