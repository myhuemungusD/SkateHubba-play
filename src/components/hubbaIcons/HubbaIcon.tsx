import { useId, type ReactNode } from "react";
import { GLYPHS, STROKE, type CutEl, type GlyphEl, type GlyphName } from "./glyphs";

export type { GlyphName };

export interface HubbaIconProps {
  name: GlyphName;
  /** Filled (active) form. Outline otherwise. */
  active?: boolean;
  size?: 20 | 24 | 28 | number;
  className?: string;
  /**
   * Accessible name. Omit when the icon sits inside an already-labelled
   * control (tab, button) — it is then aria-hidden.
   */
  label?: string;
}

function El({ el, ...rest }: { el: GlyphEl } & Record<string, unknown>): ReactNode {
  switch (el.t) {
    case "path":
      return <path d={el.d} {...rest} />;
    case "circle":
      return <circle cx={el.cx} cy={el.cy} r={el.r} {...rest} />;
    case "rect":
      return (
        <rect
          x={el.x}
          y={el.y}
          width={el.w}
          height={el.h}
          rx={el.rx}
          transform={el.rot ? `rotate(${el.rot} 12 12)` : undefined}
          {...rest}
        />
      );
  }
}

function cutPaint(c: CutEl) {
  const paint = c.mode === "keep" ? "white" : "black";
  const w = c.width ?? STROKE;
  return { fill: c.solid ? paint : "none", stroke: w ? paint : "none", strokeWidth: w };
}

/**
 * SkateHubba's custom icon. 24-unit grid, 1.75 stroke, outline when idle and
 * a filled, knocked-out form when active. Colour comes from `currentColor`,
 * so `text-brand-orange` on the parent makes the active state orange.
 * Motion classes (`hb-icon`, `hb-icon-active`) live in index.css and are
 * disabled under prefers-reduced-motion.
 */
export function HubbaIcon({ name, active = false, size = 24, className, label }: HubbaIconProps) {
  const maskId = `hb-${useId().replace(/:/g, "")}`;
  const g = GLYPHS[name] as (typeof GLYPHS)[GlyphName];
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  const cls = ["hb-icon", `hb-icon-${name}`, active ? "hb-icon-active" : "", className ?? ""].filter(Boolean).join(" ");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cls}
      data-icon={name}
      data-state={active ? "active" : "idle"}
      focusable="false"
      {...a11y}
    >
      {active ? (
        <>
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
              <rect width="24" height="24" fill="white" />
              {g.filled.cuts.map((c: CutEl, i: number) => (
                <El key={i} el={c} {...cutPaint(c)} />
              ))}
            </mask>
          </defs>
          <g mask={`url(#${maskId})`} fill="currentColor" stroke="currentColor" strokeWidth={STROKE}>
            {g.filled.body.map((e: GlyphEl, i: number) => (
              <El key={i} el={e} />
            ))}
          </g>
        </>
      ) : (
        <g stroke="currentColor" strokeWidth={STROKE}>
          {g.outline.map((e: GlyphEl, i: number) => (
            <El key={i} el={e} />
          ))}
        </g>
      )}
    </svg>
  );
}
