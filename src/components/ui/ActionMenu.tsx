import { useEffect, useId, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { useSheetFocusTrap } from "../useSheetFocusTrap";

interface ActionMenuItem {
  label: string;
  onSelect: () => void;
  /** Red text for Block / Report / Delete. */
  destructive?: boolean;
  disabled?: boolean;
}

interface ActionMenuProps {
  /** Accessible name of the ••• button, e.g. "More options for @sk8r". */
  label: string;
  items: ActionMenuItem[];
  className?: string;
  /** The ••• button, for callers that hand focus back to it after a follow-up sheet. */
  triggerRef?: Ref<HTMLButtonElement>;
}

/**
 * The ••• button and the iOS-style action sheet it opens. Report and Block
 * live here (Instagram / TikTok pattern): one tap away, out of the way of the
 * primary action, and never a bare text line under a CTA.
 */
export function ActionMenu({ label, items, className = "", triggerRef }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange ${className}`}
      >
        <MoreHorizontal size={22} aria-hidden="true" />
      </button>
      {open && <ActionSheet title={label} items={items} onClose={() => setOpen(false)} />}
    </>
  );
}

function ActionSheet({ title, items, onClose }: { title: string; items: ActionMenuItem[]; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  useSheetFocusTrap(panelRef, onClose);
  // Escape closes this sheet only. Caught on window in the capture phase so a
  // sheet underneath (e.g. comments), whose trap listens on document, stays open.
  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [onClose]);
  // Portalled: a glass parent's backdrop-filter would otherwise become the
  // containing block for `fixed`.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby={id}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-2 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
      >
        <h2 id={id} className="sr-only">
          {title}
        </h2>
        <ul className="overflow-hidden rounded-2xl bg-surface-alt">
          {items.map((item) => (
            <li key={item.label} className="border-b border-white/[0.06] last:border-b-0">
              <button
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  onClose();
                  item.onSelect();
                }}
                className={`min-h-13 w-full px-4 font-body text-base disabled:opacity-40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-orange ${
                  item.destructive ? "text-brand-red" : "text-white"
                }`}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onClose}
          className="min-h-13 w-full rounded-2xl bg-surface-alt font-body text-base font-semibold text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-orange"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}
