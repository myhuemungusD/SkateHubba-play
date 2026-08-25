import { relativeAge } from "../utils";
import type { LockerItem } from "../../../services/locker";
import { ConfirmButton } from "./ConfirmButton";

interface Props {
  items: LockerItem[];
  loading: boolean;
  username: string;
  /** Id of the item whose removal is in flight, or null. */
  removingId: string | null;
  onRemove: (itemId: string, itemName: string) => void;
}

/**
 * Current locker contents with a per-item remove affordance. Read-only detail
 * (brand, rarity, when it was acquired) is shown so an operator can tell two
 * similarly-named items apart before removing the wrong one.
 *
 * There is no edit affordance by design: minted items are immutable (the rules
 * deny updates), so correcting one means removing it and minting a replacement.
 */
export function LockerItemList({ items, loading, username, removingId, onRemove }: Props) {
  if (loading) return <p className="font-body text-xs text-subtle">Loading locker...</p>;

  if (items.length === 0) {
    return (
      <p
        data-testid="admin-locker-empty"
        className="rounded-2xl border border-dashed border-border px-4 py-6 text-center font-body text-xs text-subtle"
      >
        @{username} owns nothing yet
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li
          key={item.id}
          data-testid={`admin-locker-item-${item.id}`}
          className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3"
        >
          <div className="min-w-0">
            <p className="truncate font-display text-sm text-white">{item.name}</p>
            <p className="truncate font-body text-[11px] text-subtle">
              {item.brand ? `${item.brand} · ` : ""}
              {item.rarity} · {relativeAge(item.acquiredAt)}
            </p>
          </div>
          <ConfirmButton
            label="Remove"
            question={`Remove ${item.name} from @${username}?`}
            confirmLabel="Remove"
            tone="danger"
            loading={removingId === item.id}
            onConfirm={() => onRemove(item.id, item.name)}
          />
        </li>
      ))}
    </ul>
  );
}
