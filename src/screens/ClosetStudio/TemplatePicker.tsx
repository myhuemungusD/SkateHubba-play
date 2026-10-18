import { DesignerCredit } from "../../components/DesignerCredit";
import { MIKE_WHITE_DESIGNER } from "../../lib/closet/mikeWhiteCollection";
import { BLANK_TEMPLATE, STUDIO_TEMPLATES, type StudioTemplate } from "../../lib/closetStudio/templates";

interface Props {
  onPick: (t: StudioTemplate) => void;
}

/** Starter templates: a blank canvas plus every Mike White design, each with his credit. */
export function TemplatePicker({ onPick }: Props) {
  return (
    <div data-testid="template-picker">
      <p className="mb-2 font-body text-xs text-subtle" data-testid="template-credit-line">
        Starter templates designed by {MIKE_WHITE_DESIGNER}. Anything you make from one is credited &ldquo;Based on a
        Mike White design&rdquo;.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => onPick(BLANK_TEMPLATE)}
          className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-border font-display text-white"
        >
          {BLANK_TEMPLATE.name}
        </button>
        {STUDIO_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t)}
            className="rounded-xl border border-border p-2 text-left"
            aria-label={`Start from ${t.name}`}
          >
            <img src={t.artUrl} alt="" loading="lazy" className="aspect-square w-full object-contain" />
            <p className="mt-1 truncate font-body text-xs text-white">{t.name}</p>
            {t.designer && <DesignerCredit credit={t.designer} compact />}
          </button>
        ))}
      </div>
    </div>
  );
}
