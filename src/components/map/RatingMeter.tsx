import type { LucideIcon } from "lucide-react";

type RatingValue = 1 | 2 | 3 | 4 | 5;

export interface RatingProps {
  value: RatingValue;
  size?: "sm" | "md";
  readonly?: boolean;
  onChange?: (value: RatingValue) => void;
}

interface RatingMeterProps extends RatingProps {
  /** Icon drawn five times, filled up to `value`. */
  Icon: LucideIcon;
  /** Fill and stroke color of a filled icon. */
  color: string;
  /** Group label, read as "<label>: 3 of 5". */
  label: string;
  /** Singular unit for each button, read as "1 <unit>" / "2 <unit>s". */
  unit: string;
}

const SIZES = {
  sm: 14,
  md: 18,
} as const;

/** A 1–5 icon meter, shared by GnarRating and BustRisk. */
export function RatingMeter({
  value,
  size = "md",
  readonly = true,
  onChange,
  Icon,
  color,
  label,
  unit,
}: RatingMeterProps) {
  const px = SIZES[size];

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label={`${label}: ${value} of 5`}>
      {([1, 2, 3, 4, 5] as const).map((i) => {
        const filled = i <= value;
        return (
          <button
            key={i}
            type="button"
            disabled={readonly}
            onClick={() => onChange?.(i)}
            className={readonly ? "cursor-default" : "cursor-pointer hover:scale-110 transition-transform"}
            aria-label={`${i} ${unit}${i > 1 ? "s" : ""}`}
          >
            <Icon size={px} fill={filled ? color : "none"} color={filled ? color : "currentColor"} strokeWidth={1.5} />
          </button>
        );
      })}
    </div>
  );
}
