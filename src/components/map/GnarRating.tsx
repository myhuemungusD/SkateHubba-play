import { Flame } from "lucide-react";

interface GnarRatingProps {
  value: 1 | 2 | 3 | 4 | 5;
  size?: "sm" | "md";
  readonly?: boolean;
  onChange?: (value: 1 | 2 | 3 | 4 | 5) => void;
}

const SIZES = {
  sm: 14,
  md: 18,
} as const;

export function GnarRating({ value, size = "md", readonly = true, onChange }: GnarRatingProps) {
  const px = SIZES[size];

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label={`Gnar rating: ${value} of 5`}>
      {([1, 2, 3, 4, 5] as const).map((i) => {
        const filled = i <= value;
        return (
          <button
            key={i}
            type="button"
            disabled={readonly}
            onClick={() => onChange?.(i)}
            className={readonly ? "cursor-default" : "cursor-pointer hover:scale-110 transition-transform"}
            aria-label={`${i} flame${i > 1 ? "s" : ""}`}
          >
            <Flame
              size={px}
              fill={filled ? "#F97316" : "none"}
              color={filled ? "#F97316" : "currentColor"}
              strokeWidth={1.5}
            />
          </button>
        );
      })}
    </div>
  );
}
