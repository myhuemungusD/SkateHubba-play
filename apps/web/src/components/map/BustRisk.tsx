import { ShieldAlert } from 'lucide-react';

interface BustRiskProps {
  value: 1 | 2 | 3 | 4 | 5;
  size?: 'sm' | 'md';
  readonly?: boolean;
  onChange?: (value: 1 | 2 | 3 | 4 | 5) => void;
}

const SIZES = {
  sm: 14,
  md: 18,
} as const;

export function BustRisk({ value, size = 'md', readonly = true, onChange }: BustRiskProps) {
  const px = SIZES[size];

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label={`Bust risk: ${value} of 5`}>
      {([1, 2, 3, 4, 5] as const).map((i) => {
        const filled = i <= value;
        return (
          <button
            key={i}
            type="button"
            disabled={readonly}
            onClick={() => onChange?.(i)}
            className={readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110 transition-transform'}
            aria-label={`${i} shield${i > 1 ? 's' : ''}`}
          >
            <ShieldAlert
              size={px}
              fill={filled ? '#EF4444' : 'none'}
              color={filled ? '#EF4444' : 'currentColor'}
              strokeWidth={1.5}
            />
          </button>
        );
      })}
    </div>
  );
}
