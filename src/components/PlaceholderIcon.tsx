/**
 * Icon slots Jason is drawing (UX audit Part C4). Until his SVGs land, each
 * slot renders a plain dashed square so the layout is final and nothing
 * invented ships. Swap a slot by drawing its glyph inside the switch below;
 * the `data-icon` name stays the contract.
 */
export type PlaceholderIconName = "icon-record" | "icon-clock" | "icon-rank" | "icon-crew" | "icon-shop";

export function PlaceholderIcon({
  name,
  size = 24,
  className = "",
}: {
  name: PlaceholderIconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      data-placeholder="true"
      className={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
    </svg>
  );
}
