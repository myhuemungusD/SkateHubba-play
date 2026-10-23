import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { BackChevron } from "../../components/ScreenHeader";
import { ImagePlus, Layers, Palette, Save } from "lucide-react";
import { Avatar2D } from "../../components/Avatar2D";
import { pushRecent } from "../../lib/closetStudio/color";
import { StudioDoc, type BrushSettings } from "../../lib/closetStudio/engine";
import type { Pt, View } from "../../lib/closetStudio/geometry";
import {
  creditForTemplate,
  STUDIO_SLOTS,
  type StudioSlot,
  type StudioTemplate,
} from "../../lib/closetStudio/templates";
import {
  ClosetDesignError,
  deleteDesign,
  listMyDesigns,
  nextDesignId,
  saveDesign,
  type ClosetDesign,
} from "../../services/closetStudio";
import { ColorPanel } from "./ColorPanel";
import { LayersPanel } from "./LayersPanel";
import { MyDesigns } from "./MyDesigns";
import { StudioCanvas, type Tool } from "./StudioCanvas";
import { StudioToolbar } from "./StudioToolbar";
import { TemplatePicker } from "./TemplatePicker";
import { ToolOptions, type StampSettings } from "./ToolOptions";
import { loadFile, loadImage, toWebp } from "./io";

interface Props {
  uid: string;
  onBack: () => void;
}

const ERRORS: Record<string, string> = {
  rejected: "That design can't be shared. Keep it private or change it.",
  too_large: "That design is too big to save. Try fewer imported photos.",
  too_small: "Paint something first.",
  full: "All 24 design slots are full. Delete one to save a new design.",
  bad_name: "Give your design a name.",
};

type Panel = "color" | "layers" | "designs";

/**
 * Closet Studio: paint-style clothes editor for the avatar (behind
 * VITE_FEATURE_CLOSET_STUDIO). Loaded lazily from App. See docs/CLOSET_STUDIO.md.
 */
export function ClosetStudioScreen({ uid, onBack }: Props) {
  const [doc, setDoc] = useState(() => new StudioDoc());
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const [template, setTemplate] = useState<StudioTemplate | null>(null);
  const [designId, setDesignId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("fill");
  const [color, setColorRaw] = useState("#FF6B00");
  const [recent, setRecent] = useState<string[]>([]);
  const [brush, setBrush] = useState<Omit<BrushSettings, "color">>({ size: 18, opacity: 1, hardness: 0.8 });
  const [stamp, setStamp] = useState<StampSettings>({ sticker: "🔥", text: "HUBBA", font: "Bebas Neue", size: 64 });
  const [symmetry, setSymmetry] = useState(false);
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const [panel, setPanel] = useState<Panel>("color");
  const [slot, setSlot] = useState<StudioSlot>("shoes");
  const [name, setName] = useState("");
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [designs, setDesigns] = useState<ClosetDesign[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const setColor = (hex: string) => {
    setColorRaw(hex);
    setRecent((r) => pushRecent(r, hex));
  };

  const refreshDesigns = useCallback(() => {
    listMyDesigns(uid).then(setDesigns, () => setDesigns([]));
  }, [uid]);
  useEffect(refreshDesigns, [refreshDesigns]);

  // Live avatar preview: re-flatten after edits (deferred so strokes stay smooth).
  const previewVersion = useDeferredValue(version);
  const preview = useMemo(() => {
    if (!template || previewVersion < 0) return null;
    try {
      return doc.composite().toDataURL("image/png");
    } catch {
      return null;
    }
  }, [doc, previewVersion, template]);

  const start = async (t: StudioTemplate, image?: string, id: string | null = null) => {
    const next = new StudioDoc();
    setDoc(next);
    setTemplate(t);
    setSlot(t.slot);
    setName(id ? t.name : t.id ? `My ${t.name}`.slice(0, 40) : "");
    setDesignId(id);
    setView({ zoom: 1, panX: 0, panY: 0 });
    try {
      if (t.artUrl && !image) next.setTemplate(await loadImage(t.artUrl));
      if (image) next.importImage(await loadImage(image));
    } catch {
      setMessage("Couldn't load that picture.");
    }
    bump();
  };

  const brushFull: BrushSettings = { ...brush, color };
  const onDown = (p: Pt) => {
    if (tool === "brush" || tool === "eraser") doc.beginStroke(p, brushFull, tool === "eraser", symmetry);
    else if (tool === "fill") doc.fill(p, color, symmetry);
    else if (tool === "eyedropper") {
      const hex = doc.pick(p);
      if (hex) setColor(hex);
    } else if (tool === "sticker") doc.stamp(p, stamp.sticker, stamp.size, color, "sans-serif", symmetry);
    else if (stamp.text.trim()) doc.stamp(p, stamp.text.trim(), stamp.size, color, stamp.font, symmetry);
    bump();
  };
  const onMove = (p: Pt) => {
    if (tool !== "brush" && tool !== "eraser") return;
    doc.continueStroke(p, brushFull, tool === "eraser", symmetry);
    bump();
  };
  const onUp = () => {
    doc.endStroke();
    bump();
  };

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (!doc.importImage(await loadFile(file))) setMessage("Layer limit reached. Delete a layer first.");
    } catch {
      setMessage("Couldn't open that picture.");
    }
    bump();
  };

  const onSave = async () => {
    const id = designId ?? nextDesignId(designs.map((d) => d.id));
    if (!id) return setMessage(ERRORS.full);
    setBusy(true);
    setMessage("");
    try {
      const image = await toWebp(doc.composite());
      const saved = await saveDesign(uid, {
        id,
        name,
        slot,
        templateId: template?.id ?? "",
        layerCount: doc.layers.length,
        image,
        share,
      });
      setDesignId(saved.id);
      setMessage(saved.shared ? "Saved and shared." : "Saved.");
      refreshDesigns();
    } catch (err) {
      setMessage(
        err instanceof ClosetDesignError ? (ERRORS[err.code] ?? "Couldn't save.") : "Couldn't save. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (d: ClosetDesign) => {
    try {
      await deleteDesign(uid, d.id);
      if (designId === d.id) setDesignId(null);
    } catch {
      setMessage("Couldn't delete that design.");
    }
    refreshDesigns();
  };

  const header = (
    <div className="mb-4 flex items-center gap-3">
      <BackChevron onClick={onBack} />
      <h1 className="font-display text-2xl tracking-wide text-white">Closet Studio</h1>
    </div>
  );

  if (!template) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6" data-testid="closet-studio">
        {header}
        <TemplatePicker onPick={(t) => void start(t)} />
        <h2 className="mb-2 mt-6 font-display text-lg text-white">My designs</h2>
        <MyDesigns
          designs={designs}
          onOpen={(d) =>
            void start({ id: d.templateId, name: d.name, slot: d.slot, artUrl: "", designer: null }, d.imageUrl, d.id)
          }
          onDelete={(d) => void onDelete(d)}
        />
      </main>
    );
  }

  const credit = creditForTemplate(template.id);
  return (
    <main className="mx-auto max-w-5xl px-3 py-4" data-testid="closet-studio">
      {header}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <StudioToolbar
            tool={tool}
            onTool={setTool}
            symmetry={symmetry}
            onSymmetry={() => setSymmetry((s) => !s)}
            canUndo={doc.canUndo}
            canRedo={doc.canRedo}
            onUndo={() => doc.undo() && bump()}
            onRedo={() => doc.redo() && bump()}
            color={color}
          />
          <StudioCanvas
            doc={doc}
            version={version}
            view={view}
            onView={setView}
            onDown={onDown}
            onMove={onMove}
            onUp={onUp}
          />
          <ToolOptions
            tool={tool}
            brush={brushFull}
            onBrush={({ color: _c, ...b }) => setBrush(b)}
            stamp={stamp}
            onStamp={setStamp}
          />
        </div>
        <aside className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-border p-3" data-testid="studio-preview">
            <Avatar2D
              size="lg"
              equippedItems={
                preview
                  ? [
                      {
                        id: "studio",
                        type: slot,
                        brand: "",
                        name,
                        imageUrl: preview,
                        rarity: "common",
                        acquiredAt: null,
                        provenanceReason: null,
                        equipped: true,
                        itemDefId: null,
                      },
                    ]
                  : []
              }
            />
            <div className="min-w-0">
              <p className="font-body text-xs text-subtle">Live preview</p>
              {credit && (
                <p
                  className="font-body text-label uppercase tracking-wider text-brand-orange"
                  data-testid="studio-credit"
                >
                  {credit}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {(
              [
                ["color", "Color", Palette],
                ["layers", "Layers", Layers],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                aria-pressed={panel === id}
                onClick={() => setPanel(id)}
                className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 font-body text-xs ${panel === id ? "border-brand-orange text-brand-orange" : "border-border text-white"}`}
              >
                <Icon size={14} aria-hidden="true" /> {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 font-body text-xs text-white"
            >
              <ImagePlus size={14} aria-hidden="true" /> Import
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              data-testid="studio-import"
              onChange={(e) => void onImport(e)}
            />
          </div>
          {panel === "color" ? (
            <ColorPanel color={color} recent={recent} onColor={setColor} />
          ) : (
            <LayersPanel doc={doc} onChange={bump} />
          )}
          <div className="space-y-2 rounded-xl border border-border p-3">
            <input
              type="text"
              maxLength={40}
              value={name}
              placeholder="Design name"
              aria-label="Design name"
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-alt px-3 py-2 font-body text-sm text-white"
            />
            <select
              aria-label="Wear it as"
              value={slot}
              onChange={(e) => setSlot(e.target.value as StudioSlot)}
              className="w-full rounded-lg border border-border bg-surface-alt px-3 py-2 font-body text-sm text-white"
            >
              {STUDIO_SLOTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 font-body text-xs text-subtle">
              <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
              Share publicly (checked by the image filter first)
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onSave()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-orange py-2.5 font-display text-black disabled:opacity-50"
            >
              <Save size={16} aria-hidden="true" /> {busy ? "Saving…" : "Save design"}
            </button>
            {message && (
              <p role="status" className="font-body text-xs text-white">
                {message}
              </p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
