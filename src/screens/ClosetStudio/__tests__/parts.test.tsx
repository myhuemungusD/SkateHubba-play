import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeCanvas } from "../../../lib/closetStudio/__tests__/fakeCanvas.test-helpers";
import { StudioDoc } from "../../../lib/closetStudio/engine";
import { ColorPanel } from "../ColorPanel";
import { LayersPanel } from "../LayersPanel";
import { loadFile, loadImage, toWebp } from "../io";

describe("ColorPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installFakeCanvas();
  });

  it("picks from the wheel, brightness and exact input", () => {
    const onColor = vi.fn();
    render(<ColorPanel color="#FF0000" recent={[]} onColor={onColor} />);
    const wheel = screen.getByTestId("color-wheel");
    vi.spyOn(wheel, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.pointerDown(wheel, { clientX: 50, clientY: 50 });
    expect(onColor).toHaveBeenLastCalledWith("#FFFFFF");
    onColor.mockClear();
    fireEvent.pointerMove(wheel, { clientX: 100, clientY: 50, buttons: 0 });
    expect(onColor).not.toHaveBeenCalled();
    fireEvent.pointerMove(wheel, { clientX: 100, clientY: 50, buttons: 1 });
    expect(onColor).toHaveBeenLastCalledWith("#FF0000");
    fireEvent.change(screen.getByLabelText(/Brightness/), { target: { value: "0.5" } });
    expect(onColor).toHaveBeenLastCalledWith("#800000");
    fireEvent.change(screen.getByLabelText("Exact color"), { target: { value: "#00ff00" } });
    expect(onColor).toHaveBeenLastCalledWith("#00FF00");
  });

  it("starts black colors at full brightness and skips drawing without a context", () => {
    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(<ColorPanel color="#000000" recent={["#000000"]} onColor={vi.fn()} />);
    expect(screen.getByLabelText(/Brightness/)).toHaveValue("1");
  });
});

describe("LayersPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installFakeCanvas();
  });

  it("selects, hides, reorders, sets opacity and deletes", () => {
    const doc = new StudioDoc();
    doc.addLayer();
    const onChange = vi.fn();
    const { rerender } = render(<LayersPanel doc={doc} onChange={onChange} />);
    fireEvent.click(screen.getByText("Layer 1"));
    expect(doc.active.name).toBe("Layer 1");
    fireEvent.click(screen.getByRole("button", { name: "Hide Layer 1" }));
    rerender(<LayersPanel doc={doc} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Show Layer 1" }));
    fireEvent.change(screen.getByLabelText("Layer 2 opacity"), { target: { value: "0.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Move Layer 1 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Layer 1 down" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Layer 2" }));
    expect(doc.layers).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(7);
  });
});

describe("io", () => {
  class FakeImage {
    static fail = false;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    crossOrigin = "";
    set src(_v: string) {
      queueMicrotask(() => (FakeImage.fail ? this.onerror?.() : this.onload?.()));
    }
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("Image", FakeImage);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });

  it("loads URLs and files, revoking object URLs", async () => {
    FakeImage.fail = false;
    expect(await loadImage("/a.webp")).toBeInstanceOf(FakeImage);
    await loadFile(new File(["x"], "a.png"));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
    FakeImage.fail = true;
    await expect(loadImage("/b.webp")).rejects.toThrow("studio_image_load_failed");
  });

  it("encodes WebP and reports encode failure", async () => {
    const c = document.createElement("canvas");
    vi.spyOn(c, "toBlob").mockImplementationOnce((cb) => cb(new Blob(["x"])));
    expect(await toWebp(c)).toBeInstanceOf(Blob);
    vi.spyOn(c, "toBlob").mockImplementationOnce((cb) => cb(null));
    await expect(toWebp(c)).rejects.toThrow("studio_encode_failed");
  });
});

describe("ToolOptions", () => {
  const brush = { color: "#000000", size: 10, opacity: 1, hardness: 0.5 };
  const stamp = { sticker: "🔥", text: "HI", font: "DM Sans", size: 40 };

  it("edits brush opacity/hardness and stamp sizes", async () => {
    const { ToolOptions } = await import("../ToolOptions");
    const onBrush = vi.fn();
    const onStamp = vi.fn();
    const { rerender } = render(
      <ToolOptions tool="brush" brush={brush} onBrush={onBrush} stamp={stamp} onStamp={onStamp} />,
    );
    fireEvent.change(screen.getByLabelText(/Opacity/), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText(/Hardness/), { target: { value: "0.2" } });
    expect(onBrush).toHaveBeenLastCalledWith({ ...brush, hardness: 0.2 });
    rerender(<ToolOptions tool="sticker" brush={brush} onBrush={onBrush} stamp={stamp} onStamp={onStamp} />);
    fireEvent.change(screen.getByLabelText(/Size/), { target: { value: "80" } });
    expect(onStamp).toHaveBeenLastCalledWith({ ...stamp, size: 80 });
    rerender(<ToolOptions tool="text" brush={brush} onBrush={onBrush} stamp={stamp} onStamp={onStamp} />);
    fireEvent.change(screen.getByLabelText(/Size/), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Text to place"), { target: { value: "YO" } });
    expect(onStamp).toHaveBeenLastCalledWith({ ...stamp, text: "YO" });
    rerender(<ToolOptions tool="fill" brush={brush} onBrush={onBrush} stamp={stamp} onStamp={onStamp} />);
    expect(screen.getByTestId("tap-hint")).toHaveTextContent("Tap a panel");
  });
});
