import { Globe, Trash2 } from "lucide-react";
import type { ClosetDesign } from "../../services/closetStudio";

interface Props {
  designs: ClosetDesign[];
  onOpen: (d: ClosetDesign) => void;
  onDelete: (d: ClosetDesign) => void;
}

export function MyDesigns({ designs, onOpen, onDelete }: Props) {
  if (designs.length === 0) return <p className="font-body text-xs text-faint">No saved designs yet.</p>;
  return (
    <ul className="grid grid-cols-3 gap-2" data-testid="my-designs">
      {designs.map((d) => (
        <li key={d.id} className="rounded-xl border border-border p-1.5">
          <button type="button" className="w-full text-left" onClick={() => onOpen(d)} aria-label={`Open ${d.name}`}>
            <img src={d.imageUrl} alt="" className="aspect-square w-full rounded-lg object-contain" />
            <p className="mt-1 truncate font-body text-label text-white">{d.name}</p>
          </button>
          {d.credit && <p className="font-body text-label uppercase tracking-wider text-brand-orange">{d.credit}</p>}
          <div className="mt-1 flex items-center justify-between">
            {d.shared ? <Globe size={12} className="text-brand-green" aria-label="Shared" /> : <span />}
            <button type="button" aria-label={`Delete ${d.name}`} onClick={() => onDelete(d)}>
              <Trash2 size={12} aria-hidden="true" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
