import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeCanvas } from "../../../lib/closetStudio/__tests__/fakeCanvas.test-helpers";

const h = vi.hoisted(() => ({
  listMyDesigns: vi.fn(),
  saveDesign: vi.fn(),
  deleteDesign: vi.fn(),
  loadImage: vi.fn(),
  loadFile: vi.fn(),
  toWebp: vi.fn(),
}));

vi.mock("../../../services/closetStudio", async () => {
  const actual = await vi.importActual<typeof import("../../../services/closetStudio")>(
    "../../../services/closetStudio",
  );
  return { ...actual, listMyDesigns: h.listMyDesigns, saveDesign: h.saveDesign, deleteDesign: h.deleteDesign };
});
vi.mock("../io", () => ({ loadImage: h.loadImage, loadFile: h.loadFile, toWebp: h.toWebp }));

import { ClosetDesignError, type ClosetDesign } from "../../../services/closetStudio";
import { ClosetStudioScreen } from "../ClosetStudioScreen";

function pic(w = 64, hh = 64): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = hh;
  return c;
}

const DESIGN: ClosetDesign = {
  id: "d0",
  name: "Fire Teeth",
  slot: "shoes",
  templateId: "mike_white_teeth_fire",
  credit: "Based on a Mike White design",
  imageUrl: "https://x/d0.webp",
  layerCount: 2,
  shared: true,
};

function rect(el: Element) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 512, height: 512 } as DOMRect);
}

async function openMikeTemplate() {
  render(<ClosetStudioScreen uid="u1" onBack={vi.fn()} />);
  fireEvent.click(screen.getAllByRole("button", { name: /Start from/ })[0]);
  await screen.findByTestId("studio-canvas");
  const canvas = screen.getByTestId("studio-canvas");
  rect(canvas);
  return canvas;
}

describe("ClosetStudioScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    installFakeCanvas();
    h.listMyDesigns.mockResolvedValue([]);
    h.loadImage.mockResolvedValue(pic());
    h.loadFile.mockResolvedValue(pic(1024, 256));
    h.toWebp.mockResolvedValue(new Blob(["x"]));
    h.saveDesign.mockImplementation(async (_uid: string, input: { id: string; share: boolean }) => ({
      ...DESIGN,
      id: input.id,
      shared: input.share,
    }));
    h.deleteDesign.mockResolvedValue(undefined);
  });

  it("shows Mike White templates with credit and a back button", async () => {
    const onBack = vi.fn();
    render(<ClosetStudioScreen uid="u1" onBack={onBack} />);
    expect(screen.getByTestId("template-credit-line")).toHaveTextContent("Based on a Mike White design");
    expect(screen.getAllByTestId("designer-credit").length).toBeGreaterThan(10);
    expect(await screen.findByText("No saved designs yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("paints with every tool, undoes/redoes, zooms and shows the credit + preview", async () => {
    const canvas = await openMikeTemplate();
    expect(screen.getByTestId("studio-credit")).toHaveTextContent("Based on a Mike White design");
    expect(screen.getByTestId("avatar-2d")).toBeInTheDocument();
    const nameValue = (screen.getByLabelText("Design name") as HTMLInputElement).value;
    expect(nameValue).toMatch(/^My Mike White/);
    expect(nameValue.length).toBeLessThanOrEqual(40);

    // fill (default)
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(screen.getByRole("button", { name: "Undo" })).not.toBeDisabled();

    // brush with symmetry
    fireEvent.click(screen.getByRole("button", { name: "Symmetry" }));
    fireEvent.click(screen.getByRole("button", { name: "Brush" }));
    expect(screen.getByTestId("brush-options")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Size/), { target: { value: "40" } });
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 60, clientY: 60 });
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 60, clientY: 60 }); // unknown pointer
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    // eraser
    fireEvent.click(screen.getByRole("button", { name: "Eraser" }));
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 30, clientY: 20 });
    // second finger cancels stroke → pinch zoom
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 120, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 300, clientY: 20 });
    expect(canvas.style.transform).toMatch(/scale\((?!1\))/);
    fireEvent.pointerUp(canvas, { pointerId: 2 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    // eyedropper on painted vs empty pixel
    fireEvent.click(screen.getByRole("button", { name: "Eyedropper" }));
    expect(screen.getByTestId("tap-hint")).toHaveTextContent("grab a color");
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 5, clientY: 500 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 6, clientY: 500 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    // sticker + text
    fireEvent.click(screen.getByRole("button", { name: "Sticker" }));
    fireEvent.click(screen.getByRole("button", { name: "Sticker ⚡" }));
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    fireEvent.change(screen.getByLabelText("Font"), { target: { value: "monospace" } });
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.change(screen.getByLabelText("Text to place"), { target: { value: "  " } });
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
  });

  it("picks colors, manages layers and imports a picture", async () => {
    await openMikeTemplate();
    fireEvent.click(screen.getByRole("button", { name: "Swatch #1E88E5" }));
    expect(screen.getByRole("button", { name: "Recent #1E88E5" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    fireEvent.click(screen.getByRole("button", { name: /Add layer/ }));
    expect(screen.getByText("Layer 2")).toBeInTheDocument();

    const input = screen.getByTestId("studio-import") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    });
    expect(screen.getByText("Layer 3")).toBeInTheDocument();
    await act(async () => {
      fireEvent.change(input, { target: { files: [] } });
    });
    h.loadFile.mockRejectedValueOnce(new Error("bad"));
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(["x"], "b.png")] } });
    });
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't open that picture.");
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        fireEvent.change(input, { target: { files: [new File(["x"], "c.png")] } });
      });
    }
    expect(screen.getByRole("status")).toHaveTextContent("Layer limit reached");
  });

  it("saves, shares and maps save errors", async () => {
    await openMikeTemplate();
    fireEvent.change(screen.getByLabelText("Wear it as"), { target: { value: "top" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save design/ }));
    });
    expect(h.saveDesign).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ id: "d0", slot: "top", templateId: expect.stringMatching(/^mike_white/), share: true }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Saved and shared.");

    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save design/ }));
    });
    expect(h.saveDesign.mock.calls[1][1].id).toBe("d0"); // same slot on re-save
    expect(screen.getByRole("status")).toHaveTextContent(/^Saved\.$/);

    h.saveDesign.mockRejectedValueOnce(new ClosetDesignError("rejected"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save design/ }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("can't be shared");
    h.saveDesign.mockRejectedValueOnce(new ClosetDesignError("unauthenticated"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save design/ }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't save.");
    h.saveDesign.mockRejectedValueOnce(new Error("net"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save design/ }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("Try again");
  });

  it("refuses to save when every slot is full", async () => {
    h.listMyDesigns.mockResolvedValue(
      Array.from({ length: 24 }, (_, i) => ({ ...DESIGN, id: `d${i}`, name: `D${i}` })),
    );
    render(<ClosetStudioScreen uid="u1" onBack={vi.fn()} />);
    await screen.findByText("D23");
    fireEvent.click(screen.getByRole("button", { name: "Blank canvas" }));
    await screen.findByTestId("studio-canvas");
    expect(screen.queryByTestId("studio-credit")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save design/ }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("All 24 design slots are full");
  });

  it("lists, opens and deletes saved designs", async () => {
    h.listMyDesigns.mockResolvedValue([DESIGN]);
    render(<ClosetStudioScreen uid="u1" onBack={vi.fn()} />);
    expect(await screen.findByText("Fire Teeth")).toBeInTheDocument();
    expect(screen.getByText("Based on a Mike White design")).toBeInTheDocument();
    expect(screen.getByLabelText("Shared")).toBeInTheDocument();
    h.deleteDesign.mockRejectedValueOnce(new Error("x"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete Fire Teeth" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete Fire Teeth" }));
    });
    expect(h.deleteDesign).toHaveBeenCalledWith("u1", "d0");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Fire Teeth" }));
    });
    expect(await screen.findByTestId("studio-credit")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save design/ }));
    });
    expect(h.saveDesign.mock.calls[0][1]).toMatchObject({ id: "d0", templateId: "mike_white_teeth_fire" });
  });

  it("survives a template that fails to load, a list failure and a preview failure", async () => {
    h.listMyDesigns.mockRejectedValue(new Error("x"));
    h.loadImage.mockRejectedValueOnce(new Error("x"));
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(() => {
      throw new Error("tainted");
    });
    render(<ClosetStudioScreen uid="u1" onBack={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Start from/ })[0]);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Couldn't load that picture."));
    expect(screen.getByTestId("avatar-empty")).toBeInTheDocument();
  });
});
