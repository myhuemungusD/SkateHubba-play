import { useEffect, useRef, useState, useCallback } from "react";
import type * as mapboxgl from "mapbox-gl";
import { MAPBOX_TOKEN, MAP_STYLE, MAP_DEFAULTS, reportMapStyleConfig } from "../../lib/mapbox";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { LANDING_SPOTS, type LandingSpot } from "./landingSpots";

/**
 * Public, read-only "spot map teaser" for the marketing landing page.
 *
 * Why this exists instead of reusing SpotMap:
 *   - SpotMap calls Firestore via `useSpotsInBounds`. The landing page must
 *     not authenticate or read user-generated spot data — pins here are
 *     hardcoded in `landingSpots.ts`.
 *   - Pin interactions and pan extents are intentionally locked so unauth
 *     users can't deep-link into spot pages that 404 without a session.
 *
 * Mapbox GL JS is heavy (~500 KB). This file imports it dynamically inside
 * the init effect so the JS only loads when the component actually mounts,
 * AND the file itself is loaded via React.lazy() from Landing.tsx. Both
 * gates are required: lazy() splits the component chunk; dynamic import()
 * keeps mapbox-gl out of that chunk too.
 */

const LA_CENTER: [number, number] = [-118.2437, 34.0522];

// Bound panning to greater LA — keeps the marketing demo from drifting into
// empty ocean / desert. Values picked to comfortably contain every pin in
// LANDING_SPOTS with a little headroom.
const LA_MAX_BOUNDS: [[number, number], [number, number]] = [
  [-118.85, 33.6],
  [-117.85, 34.4],
];

interface LandingMapProps {
  onSignUpPrompt: () => void;
}

function LockedPinSvg() {
  // Inline so the marker DOM stays self-contained — no extra HTTP round-trip
  // and no lucide tree-shake surprise in the lazy chunk. The lock glyph sits
  // on a translucent orange ring so the "locked content" cue reads at a
  // glance even at small map zoom levels.
  return (
    <span
      aria-hidden="true"
      className="relative flex h-5 w-5 items-center justify-center rounded-full bg-brand-orange/90 ring-2 ring-brand-orange/40 shadow-[0_0_8px_rgba(255,107,0,0.5)]"
    >
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="white" strokeWidth="2.5">
        <rect x="5" y="11" width="14" height="9" rx="1.5" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    </span>
  );
}

function FallbackCard({ onSignUpPrompt }: LandingMapProps) {
  // Mirrors SpotMapUnavailable styling so env-less previews still get a
  // visually finished section instead of a blank gap on the landing page.
  return (
    <div className="w-full h-full flex items-center justify-center bg-surface-alt border border-white/10 rounded-2xl">
      <div className="text-center px-6 max-w-sm flex flex-col items-center">
        <div
          className="w-14 h-14 rounded-full bg-brand-orange/10 border border-brand-orange/30 flex items-center justify-center mb-4"
          aria-hidden="true"
        >
          <LockedPinSvg />
        </div>
        <p className="font-display text-base text-white mb-1.5 tracking-wide">Spots near you</p>
        <p className="font-body text-sm text-dim mb-5">Sign up to see real spots, log sessions, and scope the gnar.</p>
        <button
          type="button"
          onClick={onSignUpPrompt}
          className="px-6 py-2.5 bg-brand-orange text-white rounded-xl font-body font-semibold text-sm hover:bg-[#EA580C] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          Sign up to explore
        </button>
      </div>
    </div>
  );
}

interface CtaModalProps {
  onClose: () => void;
  onSignUpPrompt: () => void;
}

function CtaModal({ onClose, onSignUpPrompt }: CtaModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-2xl">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="landing-map-cta-title"
        className="max-w-sm mx-6 p-6 rounded-2xl bg-surface border border-white/10 shadow-2xl text-center"
      >
        <h3 id="landing-map-cta-title" className="font-display text-lg text-white tracking-wide mb-2">
          Sign up to see real spots near you
        </h3>
        <p className="font-body text-sm text-dim mb-5">
          These pins are a preview. Make an account to unlock the live map, log spots, and claim sessions.
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            autoFocus
            onClick={onSignUpPrompt}
            className="w-full px-4 py-2.5 bg-brand-orange text-white rounded-xl font-body font-semibold text-sm hover:bg-[#EA580C] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            Sign up free
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full px-4 py-2 text-dim hover:text-white text-sm font-body transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange rounded-md"
          >
            Keep looking
          </button>
        </div>
      </div>
    </div>
  );
}

// Pin marker DOM is created imperatively (mapbox-gl manages the lifecycle of
// `Marker` elements outside React's reconciler). Kept in module scope so the
// effect closure stays readable and the markup matches `LockedPinSvg`.
const PIN_CLASSNAME =
  "relative flex h-5 w-5 items-center justify-center rounded-full bg-[#FF6B00] ring-2 ring-[#FF6B00]/40 shadow-[0_0_8px_rgba(255,107,0,0.5)] cursor-pointer focus:outline-2 focus:outline-offset-2 focus:outline-white";
const PIN_INNER_SVG =
  '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="white" stroke-width="2.5" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

function createPinElement(spot: LandingSpot, onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", `${spot.name} (locked — sign up to view)`);
  el.dataset.testid = `landing-pin-${spot.id}`;
  el.className = PIN_CLASSNAME;
  el.innerHTML = PIN_INNER_SVG;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return el;
}

export function LandingMap({ onSignUpPrompt }: LandingMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [ctaOpen, setCtaOpen] = useState(false);

  const openCta = useCallback(() => setCtaOpen(true), []);
  const closeCta = useCallback(() => setCtaOpen(false), []);

  useEffect(() => {
    reportMapStyleConfig();
  }, []);

  useEffect(() => {
    // Narrow once so the closure below doesn't need a non-null assertion when
    // assigning `mapboxgl.accessToken`. The capture is intentional — even if
    // the env var changed mid-session (it can't), this effect's cleanup +
    // re-run would still see the new value via the module re-export.
    const token = MAPBOX_TOKEN;
    if (!token) return;
    if (!containerRef.current) return;
    if (mapRef.current) return;

    let cancelled = false;
    let cleanup: (() => void) | null = null;

    // Dynamic import keeps mapbox-gl out of the Landing initial chunk AND
    // out of the lazy chunk that loads this component — it lives in its own
    // chunk fetched only after this effect runs.
    void (async () => {
      const [{ default: mapboxgl }] = await Promise.all([import("mapbox-gl"), import("mapbox-gl/dist/mapbox-gl.css")]);
      if (cancelled || !containerRef.current) return;

      mapboxgl.accessToken = token;

      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: LA_CENTER,
        zoom: MAP_DEFAULTS.zoom - 3, // pulled back so multiple neighborhoods are visible
        minZoom: 9,
        maxZoom: 14,
        maxBounds: LA_MAX_BOUNDS,
        attributionControl: true,
      });

      // Disable interactions that would imply deeper navigation. Pan + zoom
      // stay enabled because they're the value prop; double-click zoom is
      // off so a frustrated "click harder" doesn't suddenly fly the user
      // out of the demo bounds.
      map.doubleClickZoom.disable();
      map.boxZoom.disable();

      mapRef.current = map;

      const markers: mapboxgl.Marker[] = [];

      map.on("load", () => {
        if (cancelled) return;
        for (const spot of LANDING_SPOTS) {
          const el = createPinElement(spot, openCta);
          const marker = new mapboxgl.Marker({ element: el }).setLngLat([spot.longitude, spot.latitude]).addTo(map);
          markers.push(marker);
        }
      });

      cleanup = () => {
        for (const m of markers) m.remove();
        map.remove();
        mapRef.current = null;
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [openCta]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="relative w-full h-[320px] md:h-[480px] rounded-2xl overflow-hidden border border-white/10">
        <FallbackCard onSignUpPrompt={onSignUpPrompt} />
      </div>
    );
  }

  return (
    <div className="relative w-full h-[320px] md:h-[480px] rounded-2xl overflow-hidden border border-white/10">
      <div ref={containerRef} className="w-full h-full" data-testid="landing-map-container" />
      {ctaOpen && <CtaModal onClose={closeCta} onSignUpPrompt={onSignUpPrompt} />}
    </div>
  );
}

export default LandingMap;
