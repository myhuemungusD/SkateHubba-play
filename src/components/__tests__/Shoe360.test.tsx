import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webgl = vi.hoisted(() => ({ ok: true }));
vi.mock("../../runner/webgl", () => ({ canUseWebGL: () => webgl.ok }));
const canvas = vi.hoisted(() => ({ throws: false, props: null as null | Record<string, unknown> }));
vi.mock("../../closet360/Shoe360Canvas", () => ({
  default: (props: Record<string, unknown>) => {
    if (canvas.throws) throw new Error("webgl lost");
    canvas.props = props;
    return <div data-testid="fake-canvas" />;
  },
}));

import { Shoe360 } from "../Shoe360";

let ioCallback: ((entries: { isIntersecting: boolean }[]) => void) | null = null;

beforeEach(() => {
  webgl.ok = true;
  canvas.throws = false;
  canvas.props = null;
  vi.stubEnv("VITE_FEATURE_SHOE_360", "true");
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: typeof ioCallback) {
        ioCallback = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const props = { itemDefId: "mike_white_m_navy_gold", imageUrl: "/card.webp", alt: "M-Logo Low" };

describe("Shoe360", () => {
  it("renders the 3D view for a skinned shoe and pauses off screen", async () => {
    render(<Shoe360 {...props} />);
    expect(await screen.findByTestId("fake-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("shoe360")).toHaveAttribute("aria-label", "M-Logo Low, 360 view. Drag to spin.");
    expect(canvas.props?.active).toBe(true);
    expect(canvas.props?.autoRotate).toBe(true);
    act(() => ioCallback?.([{ isIntersecting: false }]));
    expect(canvas.props?.active).toBe(false);
  });

  it("stops auto-rotate for reduced motion", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    render(<Shoe360 {...props} />);
    await screen.findByTestId("fake-canvas");
    expect(canvas.props?.autoRotate).toBe(false);
  });

  it("falls back to the 2D card when the flag is off", () => {
    vi.stubEnv("VITE_FEATURE_SHOE_360", "");
    render(<Shoe360 {...props} />);
    expect(screen.getByTestId("shoe360-fallback")).toHaveAttribute("src", "/card.webp");
    expect(screen.queryByTestId("shoe360")).toBeNull();
  });

  it("falls back without WebGL or without a skin", () => {
    webgl.ok = false;
    const { unmount } = render(<Shoe360 {...props} />);
    expect(screen.getByTestId("shoe360-fallback")).toBeInTheDocument();
    unmount();
    webgl.ok = true;
    render(<Shoe360 {...props} itemDefId="mike_white_dip_sets" />);
    expect(screen.getByTestId("shoe360-fallback")).toBeInTheDocument();
  });

  it("falls back to the 2D card when the scene throws", async () => {
    canvas.throws = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Shoe360 {...props} />);
    expect(await screen.findByTestId("shoe360-fallback")).toBeInTheDocument();
    expect(screen.queryByTestId("fake-canvas")).toBeNull();
  });

  it("works without IntersectionObserver", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Shoe360 {...props} />);
    expect(await screen.findByTestId("fake-canvas")).toBeInTheDocument();
  });
});
