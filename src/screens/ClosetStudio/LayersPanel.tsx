import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { MAX_LAYERS, type StudioDoc } from "../../lib/closetStudio/engine";

interface Props {
  doc: StudioDoc;
  onChange: () => void;
}

/** Layer stack, top layer first (like Procreate). */
export function LayersPanel({ doc, onChange }: Props) {
  const act = (fn: () => unknown) => () => {
    fn();
    onChange();
  };
  const top = [...doc.layers].reverse();
  return (
    <div className="space-y-2" data-testid="layers-panel">
      <button
        type="button"
        onClick={act(() => doc.addLayer())}
        disabled={doc.layers.length >= MAX_LAYERS}
        className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 font-body text-xs text-white disabled:opacity-40"
      >
        <Plus size={14} aria-hidden="true" /> Add layer ({doc.layers.length}/{MAX_LAYERS})
      </button>
      <ul className="space-y-1">
        {top.map((l) => (
          <li
            key={l.id}
            className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${l.id === doc.active.id ? "border-brand-orange" : "border-border"}`}
          >
            <button
              type="button"
              className="flex-1 text-left font-body text-xs text-white"
              onClick={act(() => doc.select(l.id))}
            >
              {l.name}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={l.opacity}
              aria-label={`${l.name} opacity`}
              onChange={(e) => {
                doc.updateLayer(l.id, { opacity: Number(e.target.value) });
                onChange();
              }}
              className="w-16"
            />
            <button
              type="button"
              aria-label={`${l.visible ? "Hide" : "Show"} ${l.name}`}
              onClick={act(() => doc.updateLayer(l.id, { visible: !l.visible }))}
            >
              {l.visible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
            </button>
            <button type="button" aria-label={`Move ${l.name} up`} onClick={act(() => doc.moveLayer(l.id, 1))}>
              <ArrowUp size={14} aria-hidden="true" />
            </button>
            <button type="button" aria-label={`Move ${l.name} down`} onClick={act(() => doc.moveLayer(l.id, -1))}>
              <ArrowDown size={14} aria-hidden="true" />
            </button>
            <button type="button" aria-label={`Delete ${l.name}`} onClick={act(() => doc.deleteLayer(l.id))}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
